const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const NodeID3 = require("node-id3");
const { app } = require("electron");

const db = require("./db");

// Archive lives inside the app's own userData folder - hidden from Spotify,
// permanent, never touched after a song lands here. This is what lets
// "trim later" work without re-downloading from YouTube.
const ARCHIVE_DIR = path.join(app.getPath("userData"), "archive");
if (!fs.existsSync(ARCHIVE_DIR)) fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

// Small helper: run a CLI tool as a child process and collect its output.
// Both yt-dlp and ffmpeg are plain command-line programs - Node doesn't
// have special bindings for them, we just spawn them like a terminal would.
function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);
    let stderr = "";
    proc.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}: ${stderr}`));
    });
    proc.on("error", (err) => {
      // ENOENT here almost always means the tool isn't installed / not on PATH
      reject(new Error(`Failed to run ${command}: ${err.message}`));
    });
  });
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

// startMs/endMs are optional - if omitted, the full song is archived and
// copied to local files untouched (matches the "fresh download, no trim
// yet" flow from the spec).
async function downloadAndProcess({ youtubeUrl, title, startMs, endMs, localFilesFolder }) {
  const safeName = sanitizeFilename(title);
  const rawPath = path.join(os.tmpdir(), `${safeName}-raw.%(ext)s`);
  const archivePath = path.join(ARCHIVE_DIR, `${safeName}.mp3`);

  // Step 1: yt-dlp extracts + converts audio to mp3 (internally shells out
  // to ffmpeg itself for the format conversion).
  await runCommand("yt-dlp", [
    "-x",
    "--audio-format", "mp3",
    "--audio-quality", "0",
    "-o", rawPath,
    youtubeUrl,
  ]);

  const actualRawPath = rawPath.replace("%(ext)s", "mp3");
  fs.copyFileSync(actualRawPath, archivePath); // permanent, untouched original
  fs.unlinkSync(actualRawPath);

  const localFilesPath = await writeTrimmedCopy({
    archivePath,
    outputName: safeName,
    startMs,
    endMs,
    localFilesFolder,
  });

  const trackId = db.insertLocalTrack({
    title,
    youtubeUrl,
    archivePath,
    localFilesPath,
    startMs,
    endMs,
  });

  return { trackId, archivePath, localFilesPath };
}

// Cuts (or copies, if no trim points given) from the archived original into
// the Spotify local files folder, then tags the result. This is the same
// function used for a brand-new download AND for "trim later" - the only
// difference is which startMs/endMs get passed in and whether an existing
// file in local files gets overwritten.
async function writeTrimmedCopy({ archivePath, outputName, startMs, endMs, localFilesFolder }) {
  const outputPath = path.join(localFilesFolder, `${outputName}.mp3`);

  if (startMs == null || endMs == null) {
    fs.copyFileSync(archivePath, outputPath);
  } else {
    const startSec = (startMs / 1000).toFixed(3);
    const endSec = (endMs / 1000).toFixed(3);
    await runCommand("ffmpeg", [
      "-y", // overwrite output if it already exists (replace-on-trim behavior)
      "-i", archivePath,
      "-ss", startSec,
      "-to", endSec,
      "-c", "copy",
      outputPath,
    ]);
  }

  return outputPath;
}

function tagFile(filePath, { title, artist, album, imagePath }) {
  const tags = { title, artist, album };
  if (imagePath) {
    tags.APIC = imagePath; // node-id3 accepts a file path directly here
  }
  NodeID3.write(tags, filePath);
}

// "Trim later" flow: look the song up in SQLite, re-cut from its archived
// original (never re-downloaded), and replace the file sitting in the
// Spotify local files folder.
async function retrimExistingTrack({ trackId, startMs, endMs, localFilesFolder }) {
  const tracks = db.getAllLocalTracks();
  const track = tracks.find((t) => t.id === trackId);
  if (!track) throw new Error(`No local track found with id ${trackId}`);

  const outputName = path.basename(track.local_files_path, ".mp3");
  const localFilesPath = await writeTrimmedCopy({
    archivePath: track.archive_path,
    outputName,
    startMs,
    endMs,
    localFilesFolder,
  });

  db.updateLocalTrackTrim(trackId, startMs, endMs);
  return { trackId, localFilesPath };
}

module.exports = { downloadAndProcess, retrimExistingTrack, tagFile };

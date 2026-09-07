const { contextBridge, ipcRenderer } = require("electron");

// contextBridge is what makes this safe: the renderer's `window` object
// gets exactly the functions listed here, nothing more. React never gets
// direct access to ipcRenderer, Node's `require`, or the filesystem - it
// can only call these specific named functions, each of which maps to one
// ipcMain.handle(...) in main.js.
contextBridge.exposeInMainWorld("api", {
  spotifyLogin: () => ipcRenderer.invoke("spotify:login"),
  getAccessToken: () => ipcRenderer.invoke("spotify:get-access-token"),

  chooseLocalFilesFolder: () => ipcRenderer.invoke("settings:choose-local-files-folder"),
  getLocalFilesFolder: () => ipcRenderer.invoke("settings:get-local-files-folder"),

  saveTrimPoint: (payload) => ipcRenderer.invoke("trim:save", payload),
  getAllTrimPoints: () => ipcRenderer.invoke("trim:get-all"),
  deleteTrimPoint: (spotifyTrackId) => ipcRenderer.invoke("trim:delete", spotifyTrackId),

  getAllLocalTracks: () => ipcRenderer.invoke("local-tracks:get-all"),
  startDownload: (payload) => ipcRenderer.invoke("download:start", payload),
  retrimTrack: (payload) => ipcRenderer.invoke("download:retrim", payload),
});

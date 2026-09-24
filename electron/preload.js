const { contextBridge, ipcRenderer } = require("electron");

// contextBridge is what makes this safe: the renderer's `window` object
// gets exactly the functions listed here, nothing more. React never gets
// direct access to ipcRenderer, Node's `require`, or the filesystem - it
// can only call these specific named functions, each of which maps to one
// ipcMain.handle(...) in main.js.
contextBridge.exposeInMainWorld("api", {
  cancelSpotifyLogin: () => ipcRenderer.invoke("spotify:cancel-login"),
  spotifyLogin: () => ipcRenderer.invoke("spotify:login"),
  getAccessToken: (accountId) => ipcRenderer.invoke("spotify:get-access-token", accountId),
  getSpotifyAccount: () => ipcRenderer.invoke("spotify:get-account"),
  spotifyLogout: () => ipcRenderer.invoke("spotify:logout"),
  getPlayback: (accountId) =>
    ipcRenderer.invoke("spotify:get-playback", accountId),
  setAutomaticTrims: (accountId, enabled) =>
    ipcRenderer.invoke("spotify:set-automatic-trims", accountId, enabled),

  chooseLocalFilesFolder: () => ipcRenderer.invoke("settings:choose-local-files-folder"),
  getLocalFilesFolder: () => ipcRenderer.invoke("settings:get-local-files-folder"),

  saveTrimPoint: (payload) => ipcRenderer.invoke("trim:save", payload),
  getTrimMetadata: (accountId, trackId) => ipcRenderer.invoke("trim:get-metadata", { accountId, trackId }),
  getAllTrimPoints: (accountId) => ipcRenderer.invoke("trim:get-all", accountId),
  hasLegacyTrims: (accountId) => ipcRenderer.invoke("trim:has-legacy", accountId),
  importLegacyTrims: (accountId) => ipcRenderer.invoke("trim:import-legacy", accountId),
  deleteTrimPoint: (accountId, spotifyTrackId) => ipcRenderer.invoke("trim:delete", { accountId, spotifyTrackId }),

  getAllLocalTracks: () => ipcRenderer.invoke("local-tracks:get-all"),
  startDownload: (payload) => ipcRenderer.invoke("download:start", payload),
  retrimTrack: (payload) => ipcRenderer.invoke("download:retrim", payload),
});

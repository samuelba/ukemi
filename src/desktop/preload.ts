import { contextBridge, ipcRenderer, webUtils } from 'electron'

// The only door between a page and the main process: one channel each way.
// Keep the names in sync with TO_MAIN and TO_RENDERER in ./context.
const TO_MAIN = 'ukemi:renderer'
const TO_RENDERER = 'ukemi:host'

contextBridge.exposeInMainWorld('ukemiHost', {
  postMessage: (message: unknown) => ipcRenderer.send(TO_MAIN, message),
  onMessage: (listener: (message: unknown) => void) => {
    ipcRenderer.on(TO_RENDERER, (_event, message: unknown) => listener(message))
  },
  platform: process.platform,
  // Pages cannot see where a dropped file lives on disk. Only the files of a drop pass here.
  pathForFile: (file: File) => webUtils.getPathForFile(file),
})

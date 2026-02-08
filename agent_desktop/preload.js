const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agentApi", {
  openBrowser: (baseUrl, token, importacionId) =>
    ipcRenderer.invoke("agent:openBrowser", { baseUrl, token, importacionId }),
  goto: (baseUrl, token, importacionId, url) =>
    ipcRenderer.invoke("agent:goto", { baseUrl, token, importacionId, url }),
  markLoggedIn: (baseUrl, token, importacionId) =>
    ipcRenderer.invoke("agent:markLoggedIn", { baseUrl, token, importacionId }),
  status: (baseUrl, token, importacionId) =>
    ipcRenderer.invoke("agent:status", { baseUrl, token, importacionId }),
  checkToken: (baseUrl, token) =>
    ipcRenderer.invoke("agent:checkToken", { baseUrl, token }),
  loadPlan: (baseUrl, token, importacionId) =>
    ipcRenderer.invoke("agent:loadPlan", { baseUrl, token, importacionId }),
  screenshot: (baseUrl, token, importacionId, label) =>
    ipcRenderer.invoke("agent:screenshot", { baseUrl, token, importacionId, label }),
  postEvent: (baseUrl, token, eventPayload) =>
    ipcRenderer.invoke("agent:postEvent", { baseUrl, token, eventPayload })
});

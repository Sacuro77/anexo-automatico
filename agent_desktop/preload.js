const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agentApi", {
  testConnection: (baseUrl, token) =>
    ipcRenderer.invoke("agent:me", { baseUrl, token }),
  downloadPlan: (baseUrl, token, importacionId) =>
    ipcRenderer.invoke("agent:plan", { baseUrl, token, importacionId }),
  registerEvent: (baseUrl, token, eventPayload) =>
    ipcRenderer.invoke("agent:event", { baseUrl, token, eventPayload }),
  openBrowser: (baseUrl, token, importacionId, url) =>
    ipcRenderer.invoke("agent:openBrowser", { baseUrl, token, importacionId, url })
});

'use strict';
// The "relay" half of the bridge (extension/entrypoints/relay.content.ts): the
// page posts a request on window, this forwards it to the main process and
// posts the answer back. Beyond that message channel, the only thing exposed on
// window is the page's own window buttons (kurapifyWindow, below).
const { contextBridge, ipcRenderer } = require('electron');

const CHANNEL = 'kurapify-bridge';

// The main process's pushes (a sign-in finished, a channel changed), as the page's event messages.
ipcRenderer.on('kurapify:event', (_event, payload) => {
  window.postMessage({ channel: CHANNEL, direction: 'event', payload }, location.origin);
});

window.addEventListener('message', async (event) => {
  if (event.origin !== location.origin) return;
  const request = event.data;
  if (!request || request.channel !== CHANNEL || request.direction !== 'to-extension') return;
  let response;
  try {
    response = await ipcRenderer.invoke('kurapify:bridge', request);
  } catch (error) {
    response = {
      channel: CHANNEL,
      protocol: request.protocol,
      direction: 'to-page',
      id: request.id,
      ok: false,
      error: { code: 'internal', message: String(error) },
    };
  }
  window.postMessage(response, location.origin);
});

// Minimise, maximise and close, for the buttons the page draws in the window's corner (the window has no frame of its own).
contextBridge.exposeInMainWorld('kurapifyWindow', {
  /** 'minimize' | 'toggle-maximize' | 'close' | 'state'; resolves to { maximized, fullScreen }. */
  act: (action) => ipcRenderer.invoke('kurapify:window', action),
  /** Told whenever the window maximises, restores, or enters or leaves full screen; returns how to stop listening. */
  onState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('kurapify:window-state', handler);
    return () => ipcRenderer.removeListener('kurapify:window-state', handler);
  },
});

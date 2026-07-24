// ==========================================
// AI Copilot Universal - Service Worker / Background (v2.9)
// ==========================================

// Listener para recibir mensajes desde content.js y lanzar notificaciones
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'NOTIFY_HOT_LEAD') {
    const { cliente, mensaje, respuestaSugerida } = request.data;

    // Almacenar temporalmente la sugerencia para recuperarla al hacer clic en la notificación
    chrome.storage.local.set({ 
      lastHotLead: { cliente, mensaje, respuestaSugerida, timestamp: Date.now() } 
    }, () => {
      chrome.notifications.create(`hot-lead-${Date.now()}`, {
        type: 'basic',
        iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        title: `🔥 Lead Caliente: ${cliente}`,
        message: `"${mensaje}"\n\n⚡ Haz clic para ver la estrategia de cierre.`,
        priority: 2,
        requireInteraction: true
      });
    });
  }
});

// Listener para manejar el clic en la notificación nativa de Chrome
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith('hot-lead-')) {
    chrome.storage.local.get(['lastHotLead'], (data) => {
      if (data.lastHotLead) {
        // Enfocar o abrir la pestaña activa de WhatsApp Web
        chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (tabs) => {
          if (tabs.length > 0) {
            chrome.tabs.update(tabs[0].id, { active: true });
            chrome.windows.update(tabs[0].windowId, { focused: true });
          } else {
            chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
          }
        });
      }
    });
    
    // Limpiar la notificación al hacer clic
    chrome.notifications.clear(notificationId);
  }
});
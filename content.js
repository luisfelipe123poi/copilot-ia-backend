// ==========================================
// AI Copilot Universal - Content Script (Voice Dictation Polish via Tone Chips & Historical Context)
// ==========================================

const processedMessages = new Set();
let isInitialized = false;

// Variable global para almacenar el último texto de audio del cliente o el dictado del usuario
let ultimoAudioTranscritoCliente = '';
let ultimoDictadoUsuario = ''; // 💡 Almacena lo que dictaste para poder pulirlo con los tonos

// ==========================================
// 💡 NUEVA FUNCIÓN: Extraer historial reciente del chat activo
// ==========================================
// ==========================================
// 💡 FUNCIÓN ACTUALIZADA: Extraer historial reciente del chat activo
// ==========================================
function getRecentChatHistory() {
  // Selectores amplios basados en atributos de contenedor de mensajes y filas de chat de WhatsApp Web
  const messageElements = document.querySelectorAll('div[data-id], div[role="row"], div._amk4, div.focusable-list-item');
  const history = [];
  const rawMessages = [];

  messageElements.forEach(el => {
    // Intentar extraer el texto interno de cualquier elemento seleccionable o contenedor de mensaje
    const textEl = el.querySelector('span.selectable-text, span.dir-ltr, div.copyable-text');
    if (textEl && textEl.innerText.trim()) {
      const text = textEl.innerText.trim();
      
      // Evitar duplicados si el DOM anidado repite los selectores
      if (!rawMessages.some(m => m.texto === text)) {
        // Determinar de forma robusta si es entrante o saliente basándose en atributos o clases comunes
        const dataId = el.getAttribute('data-id') || '';
        const isOut = dataId.includes('_true_') || el.classList.contains('message-out') || el.querySelector('[data-icon="msg-dblcheck"]');
        
        rawMessages.push({
          remitente: isOut ? 'asesor' : 'cliente',
          texto: text
        });
      }
    }
  });

  // Tomar los últimos 6 mensajes para mantener contexto eficiente
  return rawMessages.slice(-6);
}

// ==========================================
// 1. Inyección Optimizada de la Barra Lateral y Estilos
// ==========================================
function injectSidebar() {
  if (document.getElementById('ai-copilot-sidebar') && document.getElementById('ai-copilot-toggle-btn')) {
    return;
  }

  if (!document.getElementById('copilot-sidebar-styles')) {
    const style = document.createElement('style');
    style.id = 'copilot-sidebar-styles';
    style.innerHTML = `
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');

      #ai-copilot-toggle-btn {
        position: fixed;
        top: 50%;
        right: 0;
        transform: translateY(-50%);
        z-index: 999999;
        background: linear-gradient(135deg, #10b981 0%, #06b6d4 100%);
        color: #ffffff;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-right: none;
        border-radius: 14px 0 0 14px;
        padding: 14px 14px;
        cursor: pointer;
        box-shadow: -6px 0 25px rgba(16, 185, 129, 0.3);
        font-family: 'Plus Jakarta Sans', sans-serif;
        font-weight: 800;
        font-size: 13px;
        letter-spacing: 0.5px;
        transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
        display: flex;
        align-items: center;
        gap: 8px;
        backdrop-filter: blur(12px);
      }

      #ai-copilot-toggle-btn:hover {
        padding-left: 18px;
        box-shadow: -8px 0 35px rgba(6, 182, 212, 0.5);
        background: linear-gradient(135deg, #059669 0%, #0891b2 100%);
      }

      /* Clase para ocultar el botón flotante cuando el panel esté abierto */
      #ai-copilot-toggle-btn.hidden-toggle {
        opacity: 0;
        pointer-events: none;
        transform: translateY(-50%) translateX(50px);
      }

      #ai-copilot-sidebar {
        position: fixed;
        top: 0;
        right: 0;
        width: 380px;
        height: 100vh;
        background: rgba(9, 13, 20, 0.96);
        backdrop-filter: blur(24px) saturate(190%);
        -webkit-backdrop-filter: blur(24px) saturate(190%);
        color: #f3f4f6;
        z-index: 999998;
        border-left: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: -15px 0 50px rgba(0, 0, 0, 0.7);
        transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        display: flex;
        flex-direction: column;
        font-family: 'Plus Jakarta Sans', sans-serif;
      }

      #ai-copilot-sidebar.hidden {
        transform: translateX(100%);
      }

      .copilot-sidebar-header {
        padding: 20px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0) 100%);
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .copilot-brand-container {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .copilot-brand-icon {
        width: 36px;
        height: 36px;
        background: linear-gradient(135deg, #3b82f6 0%, #06b6d4 50%, #10b981 100%);
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        box-shadow: 0 4px 12px rgba(6, 182, 212, 0.3);
      }

      .copilot-brand-text {
        display: flex;
        flex-direction: column;
      }

      .copilot-brand-title-row {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .copilot-brand-title {
        font-size: 15px;
        font-weight: 800;
        color: #ffffff;
        letter-spacing: 0.5px;
      }

      .copilot-version-badge {
        font-size: 9px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 6px;
        background: rgba(6, 182, 212, 0.15);
        color: #22d3ee;
        border: 1px solid rgba(6, 182, 212, 0.3);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .copilot-brand-subtitle {
        font-size: 10px;
        color: #64748b;
        font-weight: 600;
        letter-spacing: 0.3px;
        margin-top: 2px;
      }

      .copilot-sidebar-body {
        padding: 16px 20px;
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .copilot-card-section {
        background: rgba(15, 23, 42, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 12px;
        padding: 12px 14px;
        transition: all 0.25s ease;
      }

      .copilot-label {
        font-size: 10px;
        font-weight: 700;
        color: #22d3ee;
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .copilot-grid-2 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }

      .copilot-select {
        width: 100%;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(11, 17, 32, 0.9);
        color: #f8fafc;
        font-size: 11px;
        font-weight: 600;
        outline: none;
        cursor: pointer;
        font-family: 'Plus Jakarta Sans', sans-serif;
      }

      .copilot-action-btn {
        width: 100%;
        border: none;
        padding: 13px 16px;
        border-radius: 10px;
        cursor: pointer;
        font-family: 'Plus Jakarta Sans', sans-serif;
        font-weight: 700;
        font-size: 12px;
        letter-spacing: 0.3px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }

      .btn-main-generate {
        background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(6, 182, 212, 0.15));
        border: 1px solid rgba(6, 182, 212, 0.4);
        color: #22d3ee;
      }

      .btn-inject {
        background: linear-gradient(135deg, #1e293b, #0f172a);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: #cbd5e1;
      }

      .tone-chips-container {
        display: flex;
        gap: 6px;
        margin-top: 4px;
      }

      .tone-chip {
        flex: 1;
        background: rgba(15, 23, 42, 0.8);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 8px;
        padding: 8px 6px;
        font-size: 10px;
        font-weight: 700;
        color: #94a3b8;
        cursor: pointer;
        text-align: center;
      }

      .tone-chip.active {
        background: rgba(6, 182, 212, 0.2);
        color: #22d3ee;
        border-color: rgba(6, 182, 212, 0.4);
      }

      .suggestion-box {
        background: rgba(11, 17, 32, 0.8);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 10px;
        padding: 12px;
        font-size: 11px;
        color: #94a3b8;
        line-height: 1.4;
      }
    `;
    document.head.appendChild(style);
  }

  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'ai-copilot-toggle-btn';
  toggleBtn.innerHTML = `<span style="font-size: 16px;">✨</span><span>AI CLOSER</span>`;

  const sidebar = document.createElement('div');
  sidebar.id = 'ai-copilot-sidebar';
  sidebar.className = 'hidden';

  sidebar.innerHTML = `
    <div class="copilot-sidebar-header">
      <div class="copilot-brand-container">
        <div class="copilot-brand-icon">⚡</div>
        <div class="copilot-brand-text">
          <div class="copilot-brand-title-row">
            <span class="copilot-brand-title">COPILOT.AI</span>
            <span class="copilot-version-badge">v3.7 Pro</span>
          </div>
          <span class="copilot-brand-subtitle">WhatsApp Web Overlay</span>
        </div>
      </div>
      <button id="copilot-close-btn" style="background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 18px;">✕</button>
    </div>

    <div class="copilot-sidebar-body">
      <div class="copilot-card-section" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="width: 8px; height: 8px; background-color: #10b981; border-radius: 50%;"></span>
          <span style="font-size: 11px; font-weight: 700; color: #22d3ee;">CONECTADO</span>
        </div>
        <span style="font-size: 9px; font-weight: 800; padding: 3px 8px; border-radius: 6px; background: rgba(6, 182, 212, 0.1); color: #22d3ee; border: 1px solid rgba(6, 182, 212, 0.3);">EN VIVO</span>
      </div>

      <!-- BOTÓN 1: ESCUCHAR NOTAS DE VOZ DEL CLIENTE -->
      <div class="copilot-card-section" style="border: 1px solid rgba(6, 182, 212, 0.3); background: rgba(6, 182, 212, 0.03);">
        <div class="copilot-label" style="color: #22d3ee;">// 1. ESCUCHAR NOTA DE VOZ (CLIENTE)</div>
        <button id="btn-listen-tab-audio" class="copilot-action-btn" style="background: linear-gradient(135deg, #0891b2, #06b6d4); color: #ffffff;">
          <span>🎧 Escuchar Audio de Pestaña (Cliente)</span>
        </button>
      </div>

      <!-- BOTÓN 2: DICTAR TU RESPUESTA POR VOZ (ESCRIBE SIN ENVIAR) -->
      <div class="copilot-card-section" style="border: 1px solid rgba(16, 185, 129, 0.4); background: rgba(16, 185, 129, 0.05);">
        <div class="copilot-label" style="color: #34d399;">// 2. HABLAR PARA CONTESTAR (DICTADO RÁPIDO)</div>
        <button id="btn-dictate-my-voice" class="copilot-action-btn" style="background: linear-gradient(135deg, #059669, #10b981); color: #ffffff;">
          <span>🗣️ Hablar Respuesta (Solo Escribir)</span>
        </button>
        <div style="font-size: 9px; color: #94a3b8; text-align: center; margin-top: 6px;">
          Se transcribirá y escribirá. Luego puedes mejorar el tono abajo.
        </div>
      </div>

      <!-- 🧠 NUEVA SECCIÓN: DESCIFRAR MENSAJE CONFUSO DEL CLIENTE -->
      <div class="copilot-card-section" style="border: 1px solid rgba(245, 158, 11, 0.4); background: rgba(245, 158, 11, 0.04);">
        <div class="copilot-label" style="color: #fbbf24;">// 🧠 TRADUCTOR DE CLIENTES CONFUSOS</div>
        <button id="btn-explicar-cliente" class="copilot-action-btn" style="background: linear-gradient(135deg, #d97706, #f59e0b); color: #ffffff; margin-bottom: 8px;">
          <span>💡 ¿Qué quiso decir el cliente?</span>
        </button>
        <div id="copilot-explanation-box" style="font-size: 11px; color: #fde68a; line-height: 1.4; display: none; background: rgba(11, 17, 32, 0.8); padding: 8px 10px; border-radius: 6px; border: 1px solid rgba(245, 158, 11, 0.2);"></div>
      </div>

      <div class="copilot-grid-2">
        <div class="copilot-card-section" style="padding: 10px;">
          <label class="copilot-label">Estrategia</label>
          <select id="select-modo-operacion" class="copilot-select">
            <option value="ventas">🔥 Ventas</option>
            <option value="soporte">🛠️ Soporte</option>
            <option value="informacion">💎 VIP</option>
          </select>
        </div>
        <div class="copilot-card-section" style="padding: 10px;">
          <label class="copilot-label">Tono</label>
          <select id="select-tono" class="copilot-select">
            <option value="directo">⚡ Directo</option>
            <option value="empatico">🤝 Empático</option>
            <option value="urgencia">🔥 Urgencia</option>
          </select>
        </div>
      </div>

      <button id="btn-analizar-mensaje" class="copilot-action-btn btn-main-generate">
        <span>⚡ Generar Respuesta IA (Desde Audio o Chat)</span>
      </button>

      <div class="copilot-card-section">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <div class="copilot-label" style="margin-bottom: 0;">// TRANSCRIPCIÓN / TEXTO</div>
          <span style="font-size: 9px; color: #10b981; font-weight: 700;">LISTO</span>
        </div>
        <div id="copilot-analysis-box" class="suggestion-box" style="display: block;">
          Usa los botones superiores para escuchar notas de voz o dictar tu respuesta por micrófono...
        </div>
      </div>

      <div>
        <div class="copilot-label" style="margin-bottom: 4px;">// MEJORAR / REGENERA EN OTRO TONO:</div>
        <div class="tone-chips-container">
          <div class="tone-chip" data-tono="formal">👔 Formal</div>
          <div class="tone-chip" data-tono="persuasivo">🎯 Persuasivo</div>
          <div class="tone-chip" data-tono="breve">⚡ Breve</div>
        </div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 4px;">
        <button id="btn-respuesta-rapida" class="copilot-action-btn btn-inject">
          💬 PEGAR TEXTO
        </button>
        <button id="btn-accion-1" class="copilot-action-btn btn-inject">
          🎙️ ENVIAR NOTA DE VOZ (IA)
        </button>
        <button id="btn-limpiar-todo" class="copilot-action-btn" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5;">
          🧹 LIMPIAR / RESETEAR TODO
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(toggleBtn);
  document.body.appendChild(sidebar);

  // Lógica para alternar apertura/cierre y ocultar/mostrar la etiqueta flotante
  toggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('hidden');
    const isOpen = !sidebar.classList.contains('hidden');
    
    if (isOpen) {
      toggleBtn.classList.add('hidden-toggle');
    } else {
      toggleBtn.classList.remove('hidden-toggle');
      toggleBtn.style.right = '0';
    }
  });

  document.getElementById('copilot-close-btn').addEventListener('click', () => {
    sidebar.classList.add('hidden');
    toggleBtn.classList.remove('hidden-toggle');
    toggleBtn.style.right = '0';
  });

  setupSidebarEvents();
}

// ==========================================
// 2. Variables Globales para Grabación de Audio Dual
// ==========================================
let mediaRecorderTab = null;
let audioChunksTab = [];
let isRecordingTab = false;

let mediaRecorderMic = null;
let audioChunksMic = [];
let isRecordingMic = false;

// ==========================================
// 3. Configuración de Eventos del Sidebar
// ==========================================
function setupSidebarEvents() {
  const btnAnalizar = document.getElementById('btn-analizar-mensaje');
  const btnRapida = document.getElementById('btn-respuesta-rapida');
  const btn1 = document.getElementById('btn-accion-1');
  const btnListenTabAudio = document.getElementById('btn-listen-tab-audio');
  const btnDictateMyVoice = document.getElementById('btn-dictate-my-voice');
  const btnExplicarCliente = document.getElementById('btn-explicar-cliente');
  const btnLimpiar = document.getElementById('btn-limpiar-todo');

  if (btnAnalizar) btnAnalizar.addEventListener('click', () => ejecutarAnalisisLectura(btnAnalizar));
  if (btnRapida) btnRapida.addEventListener('click', () => ejecutarAccionIA('respuesta_rapida', btnRapida));
  
  if (btnListenTabAudio) {
    btnListenTabAudio.addEventListener('click', () => toggleTabAudioRecording(btnListenTabAudio));
  }

  if (btnDictateMyVoice) {
    btnDictateMyVoice.addEventListener('click', () => toggleMyVoiceDictation(btnDictateMyVoice));
  }

  // 💡 Lógica del botón "Explicar qué quiso decir el cliente"
  if (btnExplicarCliente) {
    btnExplicarCliente.addEventListener('click', async () => {
      const ultimoMensaje = ultimoAudioTranscritoCliente || getLastReceivedMessage();
      const explanationBox = document.getElementById('copilot-explanation-box');

      if (!ultimoMensaje) {
        alert('No se detectó ningún mensaje entrante ni nota de voz para descifrar.');
        return;
      }

      btnExplicarCliente.innerHTML = '✨ Descifrando mensaje...';
      btnExplicarCliente.disabled = true;
      if (explanationBox) {
        explanationBox.style.display = 'block';
        explanationBox.innerHTML = 'Analizando el enredo del cliente...';
      }

      try {
        chrome.storage.sync.get(['licenseKey'], async (config) => {
          const res = await fetch('http://localhost:3000/api/generar-respuesta', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'x-user-license': config.licenseKey || 'TRIAL_KEY'
            },
            body: JSON.stringify({
              mensajeCliente: ultimoMensaje,
              historialChat: getRecentChatHistory(), // 💡 Historial integrado
              tipoAccion: 'analizar_explicar',
              modoOperacion: 'ventas'
            })
          });

          const data = await res.json();

          if (res.ok && data.respuesta) {
            explanationBox.innerHTML = `<strong>💡 Traducción de la IA:</strong><br>${data.respuesta}`;
          } else {
            explanationBox.innerHTML = '⚠️ No se pudo descifrar el mensaje.';
          }

          btnExplicarCliente.innerHTML = '💡 ¿Qué quiso decir el cliente?';
          btnExplicarCliente.disabled = false;
        });

      } catch (err) {
        console.error('Error al explicar:', err);
        if (explanationBox) explanationBox.innerHTML = '❌ Error al conectar con el servidor.';
        btnExplicarCliente.innerHTML = '💡 ¿Qué quiso decir el cliente?';
        btnExplicarCliente.disabled = false;
      }
    });
  }

  if (btnLimpiar) {
    btnLimpiar.addEventListener('click', () => {
      ultimoAudioTranscritoCliente = '';
      ultimoDictadoUsuario = '';

      const analysisBox = document.getElementById('copilot-analysis-box');
      if (analysisBox) {
        analysisBox.innerHTML = 'Usa los botones superiores para escuchar notas de voz o dictar tu respuesta por micrófono...';
      }

      const explanationBox = document.getElementById('copilot-explanation-box');
      if (explanationBox) {
        explanationBox.style.display = 'none';
        explanationBox.innerHTML = '';
      }

      const audioContainer = document.getElementById('copilot-audio-preview');
      if (audioContainer) {
        audioContainer.remove();
      }

      document.querySelectorAll('.tone-chip').forEach(c => c.classList.remove('active'));
      console.log('🧹 [AI Copilot] Estado reseteado con éxito.');
    });
  }
  
  if (btn1) {
    btn1.addEventListener('click', async () => {
      const ultimoMensaje = ultimoAudioTranscritoCliente || getLastReceivedMessage();
      
      if (!ultimoMensaje) {
        alert('No se detectó un mensaje entrante ni una nota de voz transcrita.');
        return;
      }

      btn1.innerHTML = '✨ Redactando respuesta de IA...';
      btn1.disabled = true;

      try {
        chrome.storage.sync.get(['nombreNegocio', 'precios', 'linkPago', 'reglas', 'licenseKey'], async (config) => {
          let contextoPersonalizado = '';
          if (config.nombreNegocio) contextoPersonalizado += `Empresa: ${config.nombreNegocio}. `;
          if (config.precios) contextoPersonalizado += `Oferta/Precios: ${config.precios}. `;
          if (config.linkPago) contextoPersonalizado += `Canales/Pagos: ${config.linkPago}. `;
          if (config.reglas) contextoPersonalizado += `Directrices/Garantías: ${config.reglas}. `;

          const modoOperacion = document.getElementById('select-modo-operacion').value;
          const tonoSeleccionado = document.getElementById('select-tono').value;

          const resResp = await fetch('http://localhost:3000/api/generar-respuesta', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'x-user-license': config.licenseKey || 'TRIAL_KEY'
            },
            body: JSON.stringify({
              mensajeCliente: ultimoMensaje,
              historialChat: getRecentChatHistory(), // 💡 Historial integrado
              contextoNegocio: contextoPersonalizado,
              modoOperacion: modoOperacion,
              tipoAccion: 'respuesta_rapida',
              tono: tonoSeleccionado
            })
          });

          const dataResp = await resResp.json();

          if (!resResp.ok || !dataResp.respuesta) {
            throw new Error(dataResp.error || 'No se pudo generar la respuesta de texto.');
          }

          const textoRespuestaRedactada = dataResp.respuesta;

          const analysisBox = document.getElementById('copilot-analysis-box');
          if (analysisBox) analysisBox.innerText = textoRespuestaRedactada;

          btn1.innerHTML = '🎙️ Sintetizando nota de voz...';

          const resAudio = await fetch('http://localhost:3000/api/generar-audio-ia', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'x-user-license': config.licenseKey || ''
            },
            body: JSON.stringify({ texto: textoRespuestaRedactada })
          });

          if (!resAudio.ok) throw new Error('No se pudo convertir el texto redactado en audio.');

          const blobAudio = await resAudio.blob();
          const audioFile = new File([blobAudio], "nota_voz_ia.ogg", { type: "audio/ogg" });

          await injectAudioFileIntoWhatsApp(audioFile);

          const audioUrl = URL.createObjectURL(blobAudio);
          let audioContainer = document.getElementById('copilot-audio-preview');
          if (!audioContainer) {
            audioContainer = document.createElement('div');
            audioContainer.id = 'copilot-audio-preview';
            audioContainer.style.cssText = 'margin-top: 10px; padding: 8px; background: rgba(15, 23, 42, 0.9); border: 1px solid rgba(6, 182, 212, 0.3); border-radius: 8px; text-align: center;';
            btn1.parentNode.insertBefore(audioContainer, btn1.nextSibling);
          }

          audioContainer.innerHTML = `
            <div style="font-size: 10px; color: #10b981; margin-bottom: 4px; font-weight: 700;">// NOTA DE VOZ IA ENVIADA ✅</div>
            <audio controls src="${audioUrl}" style="width: 100%; height: 32px;"></audio>
          `;

          btn1.innerHTML = '🎙️ ENVIAR NOTA DE VOZ (IA)';
          btn1.disabled = false;
        });

      } catch (err) {
        console.error('Error:', err);
        alert('Error al procesar la nota de voz: ' + err.message);
        btn1.innerHTML = '🎙️ ENVIAR NOTA DE VOZ (IA)';
        btn1.disabled = false;
      }
    });
  }

  document.querySelectorAll('.tone-chip').forEach(chip => {
    chip.addEventListener('click', async (e) => {
      document.querySelectorAll('.tone-chip').forEach(c => c.classList.remove('active'));
      e.currentTarget.classList.add('active');
      const tonoElegido = e.currentTarget.getAttribute('data-tono');
      await ejecutarAccionIAConTono(tonoElegido);
    });
  });
}

// ==========================================
// 3.1 Función de Inyección de Archivos de Audio en WhatsApp Web
// ==========================================
async function injectAudioFileIntoWhatsApp(file) {
  const mainChatContainer = document.querySelector('#main') || document.querySelector('div[data-tab="6"]');
  
  if (!mainChatContainer) {
    alert('Abre un chat activo en WhatsApp Web para enviar la nota de voz.');
    return;
  }

  try {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    const pasteEvent = new ClipboardEvent('paste', {
      clipboardData: dataTransfer,
      bubbles: true,
      cancelable: true
    });

    mainChatContainer.dispatchEvent(pasteEvent);

    setTimeout(() => {
      const sendMediaButton = document.querySelector('span[data-icon="send"]') ||
                             document.querySelector('div[aria-label="Enviar"]') ||
                             document.querySelector('button[aria-label="Enviar"]');
      if (sendMediaButton) {
        sendMediaButton.click();
      }
    }, 1200);

  } catch (error) {
    console.error('Error al inyectar el audio en WhatsApp:', error);
    alert('No se pudo adjuntar el audio automáticamente. Intenta arrastrar el archivo generado a la ventana del chat.');
  }
}

// ==========================================
// 4A. Captura de Audio de Pestaña (Notas de voz del cliente)
// ==========================================
async function toggleTabAudioRecording(buttonElement) {
  const analysisBox = document.getElementById('copilot-analysis-box');

  if (!isRecordingTab) {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ 
        video: { displaySurface: "browser" }, 
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
        preferCurrentTab: true
      });

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error("No se seleccionó audio. Asegúrate de marcar 'Compartir audio de la pestaña'.");
      }

      stream.getVideoTracks().forEach(track => track.stop());

      const audioOnlyStream = new MediaStream([audioTracks[0]]);
      audioChunksTab = [];
      mediaRecorderTab = new MediaRecorder(audioOnlyStream);

      mediaRecorderTab.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksTab.push(event.data);
        }
      };

      mediaRecorderTab.onstop = async () => {
        const audioBlob = new Blob(audioChunksTab, { type: 'audio/webm' });
        audioOnlyStream.getTracks().forEach(track => track.stop());

        if (analysisBox) {
          analysisBox.innerHTML = '<span style="color: #38bdf8;">🔄 Transcribiendo nota de voz del cliente...</span>';
        }

        const formData = new FormData();
        formData.append('audio', audioBlob, 'audio_interno.webm');

        try {
          chrome.storage.sync.get(['licenseKey'], async (config) => {
            const res = await fetch('http://localhost:3000/api/transcribir-audio-cliente', {
              method: 'POST',
              headers: {
                'x-user-license': config.licenseKey || 'TRIAL_KEY'
              },
              body: formData
            });

            const data = await res.json();

            if (res.ok && data.texto) {
              ultimoAudioTranscritoCliente = data.texto;

              if (analysisBox) {
                analysisBox.innerHTML = `
                  <div style="color: #22d3ee; font-weight: 700; margin-bottom: 4px;">// NOTA DE VOZ TRANSCRIBIDA (CLIENTE):</div>
                  <div style="color: #e2e8f0; font-size: 12px; line-height: 1.5; margin-bottom: 8px;">"${data.texto}"</div>
                  <div style="font-size: 10px; color: #10b981; font-weight: 700; background: rgba(16,185,129,0.1); padding: 4px; border-radius: 4px; text-align: center;">✅ ¡Listo! Ahora haz clic en "⚡ Generar Respuesta IA"</div>
                `;
              }
            } else {
              throw new Error(data.error || 'El servidor devolvió un error en la transcripción.');
            }
          });
        } catch (err) {
          console.error('Error al enviar audio al servidor:', err);
          if (analysisBox) {
            analysisBox.innerHTML = `<span style="color: #f43f5e;">❌ Error: ${err.message}</span>`;
          }
        }
      };

      mediaRecorderTab.start();
      isRecordingTab = true;
      buttonElement.style.background = 'linear-gradient(135deg, #dc2626, #f43f5e)';
      buttonElement.innerHTML = '⏹️ Detener Escucha de Pestaña';
      
      if (analysisBox) {
        analysisBox.innerHTML = '<span style="color: #34d399; font-weight: 700;">🔴 Escuchando nota de voz del cliente...</span>';
      }

    } catch (err) {
      console.error('Error al capturar audio de pestaña:', err);
      alert('Debes seleccionar la pestaña actual y marcar la opción "Compartir audio de la pestaña".');
    }
  } else {
    if (mediaRecorderTab && mediaRecorderTab.state !== 'inactive') {
      mediaRecorderTab.stop();
    }
    isRecordingTab = false;
    buttonElement.style.background = 'linear-gradient(135deg, #0891b2, #06b6d4)';
    buttonElement.innerHTML = '🎧 Escuchar Audio de Pestaña (Cliente)';
  }
}

// ==========================================
// 4B. Dictado por Micrófono (Escribe y guarda para pulir con tono)
// ==========================================
async function toggleMyVoiceDictation(buttonElement) {
  const analysisBox = document.getElementById('copilot-analysis-box');

  if (!isRecordingMic) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksMic = [];
      mediaRecorderMic = new MediaRecorder(stream);

      mediaRecorderMic.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksMic.push(event.data);
        }
      };

      mediaRecorderMic.onstop = async () => {
        const audioBlob = new Blob(audioChunksMic, { type: 'audio/webm' });
        stream.getTracks().forEach(track => track.stop());

        if (analysisBox) {
          analysisBox.innerHTML = '<span style="color: #38bdf8;">🔄 Transcribiendo tu dictado por voz...</span>';
        }

        const formData = new FormData();
        formData.append('audio', audioBlob, 'dictado_usuario.webm');

        try {
          chrome.storage.sync.get(['licenseKey'], async (config) => {
            const res = await fetch('http://localhost:3000/api/transcribir-audio-cliente', {
              method: 'POST',
              headers: {
                'x-user-license': config.licenseKey || 'TRIAL_KEY'
              },
              body: formData
            });

            const data = await res.json();

            if (res.ok && data.texto) {
              ultimoDictadoUsuario = data.texto;

              if (analysisBox) {
                analysisBox.innerHTML = `
                  <div style="color: #34d399; font-weight: 700; margin-bottom: 4px;">// TU DICTADO TRANSCRITO:</div>
                  <div style="color: #e2e8f0; font-size: 12px; line-height: 1.5; margin-bottom: 6px;">"${data.texto}"</div>
                  <div style="font-size: 9px; color: #22d3ee;">💡 Selecciona un tono abajo (Formal, Persuasivo, Breve) para pulirlo y adaptarlo profesionalmente.</div>
                `;
              }
              insertTextIntoWhatsAppOnly(data.texto);
            } else {
              throw new Error(data.error || 'El servidor devolvió un error en la transcripción.');
            }
          });
        } catch (err) {
          console.error('Error al enviar dictado al servidor:', err);
          if (analysisBox) {
            analysisBox.innerHTML = `<span style="color: #f43f5e;">❌ Error: ${err.message}</span>`;
          }
        }
      };

      mediaRecorderMic.start();
      isRecordingMic = true;
      buttonElement.style.background = 'linear-gradient(135deg, #dc2626, #f43f5e)';
      buttonElement.innerHTML = '⏹️ Detener Dictado';
      
      if (analysisBox) {
        analysisBox.innerHTML = '<span style="color: #34d399; font-weight: 700;">🗣️ Hablando... Di tu respuesta.</span>';
      }

    } catch (err) {
      console.error('Error al acceder al micrófono:', err);
      alert('No se pudo acceder al micrófono. Concede permisos en tu navegador.');
    }
  } else {
    if (mediaRecorderMic && mediaRecorderMic.state !== 'inactive') {
      mediaRecorderMic.stop();
    }
    isRecordingMic = false;
    buttonElement.style.background = 'linear-gradient(135deg, #059669, #10b981)';
    buttonElement.innerHTML = '🗣️ Hablar Respuesta (Solo Escribir)';
  }
}

// ==========================================
// 5. Observer Unificado de Chats
// ==========================================
let debounceTimer = null;
function observeIncomingChats() {
  const chatListContainer = document.querySelector('div[aria-label="Lista de chats"]') || document.querySelector('#pane-side');
  
  const chatObserver = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (!chatListContainer) return;
      const unreadBadges = document.querySelectorAll('span[aria-label*="no leído"], span._23v3o, span._1PJ2b');

      unreadBadges.forEach(badge => {
        const chatRow = badge.closest('div[role="listitem"]') || badge.closest('div._199A8');
        if (!chatRow) return;

        const titleEl = chatRow.querySelector('span[title]') || chatRow.querySelector('div._21S48');
        const msgEl = chatRow.querySelector('span._11J2D') || chatRow.querySelector('span._21S48');

        if (titleEl && msgEl) {
          const cliente = titleEl.innerText || titleEl.getAttribute('title');
          const mensajeTexto = msgEl.innerText;
          const msgId = `${cliente}:${mensajeTexto}`;

          if (!processedMessages.has(msgId)) {
            processedMessages.add(msgId);
            analizarMensajeProactivo(cliente, mensajeTexto);
          }
        }
      });
    }, 400);
  });

  const conversationPanel = document.querySelector('#main') || document.body;
  chatObserver.observe(conversationPanel, { childList: true, subtree: true });
  if (chatListContainer) {
    chatObserver.observe(chatListContainer, { childList: true, subtree: true });
  }
}

// ==========================================
// 6. Análisis Proactivo de Intención
// ==========================================
async function analizarMensajeProactivo(cliente, mensajeTexto) {
  try {
    const res = await fetch('http://localhost:3000/api/analizar-intencion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente, mensaje: mensajeTexto })
    });

    const data = await res.json();

    if (data.prioridad === 'ALTA') {
      chrome.runtime.sendMessage({
        type: 'NOTIFY_HOT_LEAD',
        data: {
          cliente,
          mensaje: mensajeTexto,
          respuestaSugerida: data.respuestaSugerida
        }
      });
    }
  } catch (err) {
    console.error('Error en análisis proactivo:', err);
  }
}

// ==========================================
// 7. Análisis de Lectura y Actualización Dinámica
// ==========================================
async function ejecutarAnalisisLectura(btnPresionado) {
  const ultimoMensaje = ultimoAudioTranscritoCliente || getLastReceivedMessage();
  
  if (!ultimoMensaje) {
    alert('No se detectó un mensaje entrante ni una nota de voz transcrita.');
    return;
  }

  const analysisBox = document.getElementById('copilot-analysis-box');
  if (analysisBox) analysisBox.innerHTML = '<span style="color: #38bdf8;">✨ Analizando intención y generando respuesta...</span>';
  if (btnPresionado) btnPresionado.disabled = true;

  try {
    chrome.storage.sync.get(['licenseKey'], async (config) => {
      const resRespuesta = await fetch('http://localhost:3000/api/generar-respuesta', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-license': config.licenseKey || 'TRIAL_KEY'
        },
        body: JSON.stringify({
          mensajeCliente: ultimoMensaje,
          historialChat: getRecentChatHistory(), // 💡 Historial integrado
          tipoAccion: 'analizar_explicar',
          modoOperacion: 'ventas'
        })
      });

      const dataRespuesta = await resRespuesta.json();

      if (resRespuesta.ok) {
        if (analysisBox) {
          analysisBox.innerHTML = dataRespuesta.respuesta || "Estrategia generada con éxito.";
        }
      } else {
        if (analysisBox) analysisBox.innerText = `⚠️ Error al procesar el mensaje.`;
      }

      if (btnPresionado) btnPresionado.disabled = false;
    });

  } catch (err) {
    console.error('Error en análisis dinámico:', err);
    if (analysisBox) analysisBox.innerText = '❌ Error de conexión con el servidor local.';
    if (btnPresionado) btnPresionado.disabled = false;
  }
}

// ==========================================
// 8. Generación de Respuestas de Cierre
// ==========================================
async function ejecutarAccionIA(tipoAccion = 'respuesta_rapida', btnPresionado = null) {
  const ultimoMensaje = ultimoAudioTranscritoCliente || getLastReceivedMessage();
  
  if (!ultimoMensaje) {
    alert('No se detectó un mensaje entrante ni una nota de voz transcrita.');
    return;
  }

  const btnAnalizar = document.getElementById('btn-analizar-mensaje');
  const btnRapida = document.getElementById('btn-respuesta-rapida');
  const btn1 = document.getElementById('btn-accion-1');
  const analysisBox = document.getElementById('copilot-analysis-box');
  const modoOperacion = document.getElementById('select-modo-operacion').value;
  const tonoSeleccionado = document.getElementById('select-tono').value;

  if (btnAnalizar) btnAnalizar.disabled = true;
  if (btnRapida) btnRapida.disabled = true;
  if (btn1) btn1.disabled = true;

  const textoOriginalBtn = btnPresionado ? btnPresionado.innerHTML : '';
  if (btnPresionado) btnPresionado.innerHTML = '✨ Procesando...';
  
  if (analysisBox) {
    analysisBox.innerHTML = '<span style="color: #38bdf8;">✨ Generando respuesta sugerida...</span>';
  }

  try {
    chrome.storage.sync.get(['nombreNegocio', 'precios', 'linkPago', 'reglas', 'licenseKey'], async (config) => {
      let contextoPersonalizado = '';
      if (config.nombreNegocio) contextoPersonalizado += `Empresa: ${config.nombreNegocio}. `;
      if (config.precios) contextoPersonalizado += `Oferta/Precios: ${config.precios}. `;
      if (config.linkPago) contextoPersonalizado += `Canales/Pagos: ${config.linkPago}. `;
      if (config.reglas) contextoPersonalizado += `Directrices/Garantías: ${config.reglas}. `;

      const res = await fetch('http://localhost:3000/api/generar-respuesta', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-license': config.licenseKey || 'TRIAL_KEY'
        },
        body: JSON.stringify({
          mensajeCliente: ultimoMensaje,
          historialChat: getRecentChatHistory(), // 💡 Historial integrado
          contextoNegocio: contextoPersonalizado,
          modoOperacion: modoOperacion,
          tipoAccion: tipoAccion,
          tono: tonoSeleccionado
        })
      });

      const data = await res.json();

      if (res.ok && data.respuesta) {
        if (analysisBox) {
          analysisBox.innerText = data.respuesta;
        }
        insertTextIntoWhatsApp(data.respuesta);
      } else {
        if (analysisBox) analysisBox.innerText = '⚠️ Error al generar respuesta.';
        alert(`Error: ${data.error || 'Error en la solicitud'}`);
      }

      if (btnAnalizar) btnAnalizar.disabled = false;
      if (btnRapida) btnRapida.disabled = false;
      if (btn1) btn1.disabled = false;
      if (btnPresionado) btnPresionado.innerHTML = textoOriginalBtn;
    });

  } catch (err) {
    console.error('Error al conectar:', err);
    if (analysisBox) analysisBox.innerText = '❌ Error de conexión con el servidor.';
    alert('Asegúrate de que tu servidor esté activo en http://localhost:3000.');
    if (btnAnalizar) btnAnalizar.disabled = false;
    if (btnRapida) btnRapida.disabled = false;
    if (btn1) btn1.disabled = false;
    if (btnPresionado) btnPresionado.innerHTML = textoOriginalBtn;
  }
}

async function ejecutarAccionIAConTono(tonoChip) {
  const textoBase = ultimoDictadoUsuario || ultimoAudioTranscritoCliente || getLastReceivedMessage();
  if (!textoBase) return;

  const modoOperacion = document.getElementById('select-modo-operacion').value;
  const analysisBox = document.getElementById('copilot-analysis-box');

  if (analysisBox) analysisBox.innerHTML = `<span style="color: #38bdf8;">✨ Puliendo texto a tono "${tonoChip}"...</span>`;

  try {
    chrome.storage.sync.get(['nombreNegocio', 'precios', 'linkPago', 'reglas', 'licenseKey'], async (config) => {
      let contextoPersonalizado = '';
      if (config.nombreNegocio) contextoPersonalizado += `Empresa: ${config.nombreNegocio}. `;

      const payloadBody = ultimoDictadoUsuario ? {
        mensajeCliente: `Reformula y pule el siguiente borrador dictado por mí de manera profesional, usando un tono "${tonoChip}", conservando exactamente mi idea central para responderle a un cliente: "${ultimoDictadoUsuario}"`,
        historialChat: getRecentChatHistory(), // 💡 Historial integrado
        contextoNegocio: contextoPersonalizado,
        modoOperacion: modoOperacion,
        tipoAccion: 'respuesta_rapida',
        tono: tonoChip
      } : {
        mensajeCliente: textoBase,
        historialChat: getRecentChatHistory(), // 💡 Historial integrado
        contextoNegocio: contextoPersonalizado,
        modoOperacion: modoOperacion,
        tipoAccion: 'respuesta_rapida',
        tono: tonoChip
      };

      const res = await fetch('http://localhost:3000/api/generar-respuesta', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-license': config.licenseKey || 'TRIAL_KEY'
        },
        body: JSON.stringify(payloadBody)
      });

      const data = await res.json();
      if (res.ok && data.respuesta) {
        if (analysisBox) analysisBox.innerText = data.respuesta;
        replaceTextInWhatsApp(data.respuesta);
        ultimoDictadoUsuario = '';
      } else {
        if (analysisBox) analysisBox.innerText = '⚠️ Error al pulir el tono.';
      }
    });
  } catch (err) {
    console.error('Error en chip de tono:', err);
    if (analysisBox) analysisBox.innerText = '❌ Error de conexión.';
  }
}

// ==========================================
// 9. Lectura de Mensajes
// ==========================================
function getLastReceivedMessage() {
  const copyableElements = document.querySelectorAll('div.copyable-text');
  if (copyableElements.length > 0) {
    const chatMessages = Array.from(copyableElements).filter(el => !el.closest('footer'));
    if (chatMessages.length > 0) {
      const lastMessageEl = chatMessages[chatMessages.length - 1];
      const spanText = lastMessageEl.querySelector('span.selectable-text') || lastMessageEl;
      if (spanText && spanText.innerText.trim()) {
        return spanText.innerText.trim();
      }
    }
  }

  const incomingMessages = document.querySelectorAll('div.message-in');
  if (incomingMessages.length > 0) {
    const lastIncoming = incomingMessages[incomingMessages.length - 1];
    return lastIncoming.innerText.split('\n')[0].trim();
  }

  const analysisBox = document.getElementById('copilot-analysis-box');
  if (analysisBox && analysisBox.innerText && !analysisBox.innerText.includes('Usa los botones')) {
    return analysisBox.innerText;
  }

  return null;
}

// ==========================================
// 10. Inserción y Reemplazo de Texto en WhatsApp
// ==========================================
function insertTextIntoWhatsApp(text) {
  const messageInput = document.querySelector('footer div[contenteditable="true"]');

  if (messageInput) {
    messageInput.focus();
    document.execCommand('insertText', false, text);

    chrome.storage.sync.get(['modoEnvio'], (config) => {
      if (config.modoEnvio === 'auto') {
        setTimeout(() => {
          const sendButton = document.querySelector('button[aria-label="Enviar"]') ||
                             document.querySelector('span[data-icon="send"]');

          if (sendButton) {
            sendButton.click();
          }
        }, 200);
      }
    });
  }
}

function insertTextIntoWhatsAppOnly(text) {
  const messageInput = document.querySelector('footer div[contenteditable="true"]');

  if (messageInput) {
    messageInput.focus();
    document.execCommand('insertText', false, text);
  }
}

function replaceTextInWhatsApp(text) {
  const messageInput = document.querySelector('footer div[contenteditable="true"]');

  if (messageInput) {
    messageInput.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, text);
  }
}

// ==========================================
// 11. Inicializador Seguro
// ==========================================
function initCopilot() {
  console.log("🔥 [AI Copilot] Intentando inicializar en WhatsApp Web...");
  if (isInitialized) return;
  
  const paneSide = document.querySelector('#pane-side') || document.querySelector('div[aria-label="Lista de chats"]');
  if (paneSide || document.querySelector('#main')) {
    isInitialized = true;
    console.log("🚀 [AI Copilot] ¡Elementos encontrados! Inyectando barra lateral...");
    injectSidebar();
    observeIncomingChats();
  }
}

const loadCheckInterval = setInterval(() => {
  if (document.querySelector('#pane-side') || document.querySelector('div[aria-label="Lista de chats"]') || document.querySelector('#main')) {
    initCopilot();
    clearInterval(loadCheckInterval);
  }
}, 1000);
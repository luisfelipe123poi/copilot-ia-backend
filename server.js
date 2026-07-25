// ==========================================
// AI Copilot Universal - Backend Producción (MongoDB + PayPal)
// ==========================================

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import crypto from 'crypto';
import multer from 'multer';
import mongoose from 'mongoose';
import checkoutNodeJssdk from '@paypal/checkout-server-sdk';

dotenv.config();

const app = express();

// Configuración de Multer para recibir archivos temporales de audio en memoria
const upload = multer({ storage: multer.memoryStorage() });

// Middlewares
app.use(cors());
app.use(express.json());

// 1. Conexión a MongoDB (Permanente para Producción)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/copilot-ai';
mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ Conectado exitosamente a MongoDB Atlas'))
  .catch(err => console.error('❌ Error conectando a MongoDB:', err));

// Esquema de Licencias en Base de Datos
const licenseSchema = new mongoose.Schema({
  licenseKey: { type: String, required: true, unique: true },
  status: { type: String, enum: ['trial', 'active', 'expired'], default: 'trial' },
  usageCount: { type: Number, default: 0 },
  email: { type: String, required: true },
  expiresAt: { type: Date, required: true }
});
const License = mongoose.model('License', licenseSchema);

// Instancia de OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Configuración de PayPal (Entorno Live / Producción)
function client() {
  return new checkoutNodeJssdk.core.LiveEnvironment(
    process.env.PAYPAL_CLIENT_ID || 'TU_PAYPAL_CLIENT_ID',
    process.env.PAYPAL_CLIENT_SECRET || 'TU_PAYPAL_SECRET'
  );
}
function paypalClient() {
  return new checkoutNodeJssdk.core.PayPalHttpClient(client());
}

// Contexto base por defecto si el usuario no configura nada
const CONTEXTO_NEGOCIO_DEFAULT = `
Somos una empresa que ofrece soluciones de software, páginas web, soporte técnico y automatizaciones para negocios.
Ofrecemos atención de alta calidad, acompañamiento continuo y facilidades de acceso.
`;

const USAGE_LIMIT_FREE_TRIAL = 1000;

// Helper para generar claves de licencia únicas (ej: PRES-A1B2-C3D4-E5F6)
function generateLicenseKey(prefix = 'PRES') {
  const bytes = crypto.randomBytes(6).toString('hex').toUpperCase();
  const part1 = bytes.substring(0, 4);
  const part2 = bytes.substring(4, 8);
  const part3 = bytes.substring(8, 12);
  return `${prefix}-${part1}-${part2}-${part3}`;
}

// ==========================================
// MIDDLEWARE: Validación de Licencia en MongoDB
// ==========================================
async function validarLicencia(req, res, next) {
  const licenseKey = req.headers['x-user-license'] || 'TRIAL_KEY';

  let user = await License.findOne({ licenseKey });

  if (!user) {
    // Si no existe, lo creamos como Trial por defecto en MongoDB
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 días de prueba
    user = await License.create({
      licenseKey,
      status: 'trial',
      usageCount: 0,
      email: 'trial_user@system.local',
      expiresAt
    });
  }

  if (user.status === 'trial') {
    if (user.usageCount >= USAGE_LIMIT_FREE_TRIAL) {
      return res.status(403).json({
        error: `Has agotado tus ${USAGE_LIMIT_FREE_TRIAL} respuestas de prueba. ¡Activa tu plan Pro para continuar!`,
        code: 'TRIAL_EXPIRED'
      });
    }
    user.usageCount += 1;
    await user.save();
  } else if (user.status === 'active') {
    if (new Date(user.expiresAt) < new Date()) {
      user.status = 'expired';
      await user.save();
      return res.status(403).json({
        error: 'Tu suscripción ha expirado. Por favor renueva tu plan.',
        code: 'TRIAL_EXPIRED'
      });
    }
  } else {
    return res.status(403).json({ 
      error: 'Tu suscripción no está activa. Revisa tu estado de pago.',
      code: 'SUBSCRIPTION_INACTIVE'
    });
  }

  next();
}

// ==========================================
// ENDPOINT PAYPAL: Crear Orden de Pago
// ==========================================
app.post('/api/crear-orden-paypal', async (req, res) => {
  try {
    const { plan, email } = req.body; // plan: 'mensual' ($15) o 'anual' ($120)
    const precio = plan === 'anual' ? '120.00' : '15.00';

    const request = new checkoutNodeJssdk.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: 'USD',
          value: precio
        },
        description: `Licencia AI Sales Copilot - Plan ${plan.toUpperCase()} (${email})`
      }],
      application_context: {
        return_url: `${process.env.FRONTEND_URL || 'https://copilot.prestigecloser.com'}/gracias.html`,
        cancel_url: `${process.env.FRONTEND_URL || 'https://copilot.prestigecloser.com'}/cancelado.html`
      }
    });

    const response = await paypalClient().execute(request);
    const approveLink = response.result.links.find(link => link.rel === 'approve').href;
    res.json({ id: response.result.id, approve_link: approveLink });

  } catch (error) {
    console.error('Error creando orden en PayPal:', error);
    res.status(500).json({ error: 'No se pudo procesar la orden con PayPal.' });
  }
});

// ==========================================
// ENDPOINT PAYPAL: Capturar Pago y Generar Licencia en MongoDB
// ==========================================
app.post('/api/capturar-pago-paypal', async (req, res) => {
  try {
    const { orderID, email } = req.body;

    const request = new checkoutNodeJssdk.orders.OrdersCaptureRequest(orderID);
    request.requestBody({});

    const response = await paypalClient().execute(request);

    if (response.result.status === 'COMPLETED') {
      const newLicenseKey = generateLicenseKey('PRES');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // 30 días de acceso Pro

      await License.create({
        licenseKey: newLicenseKey,
        status: 'active',
        usageCount: 0,
        email: email || 'cliente@desconocido.com',
        expiresAt
      });

      console.log(`\n==================================================`);
      console.log(`✅ ¡PAGO EXITOSO Y LICENCIA GENERADA EN MONGO!`);
      console.log(`Email: ${email}`);
      console.log(`Clave: ${newLicenseKey}`);
      console.log(`==================================================\n`);

      return res.json({ success: true, licenseKey: newLicenseKey });
    } else {
      return res.status(400).json({ success: false, error: 'El pago no se completó correctamente.' });
    }

  } catch (error) {
    console.error('Error al capturar pago PayPal:', error);
    res.status(500).json({ error: 'Error interno al validar el pago.' });
  }
});

// ==========================================
// ENDPOINT NUEVO: Generador de System Prompt Personalizado (Meta-Prompt)
// ==========================================
app.post('/api/generar-system-prompt', async (req, res) => {
  try {
    const { descripcionNegocio, objetivoBot } = req.body;

    if (!descripcionNegocio) {
      return res.status(400).json({ error: 'La descripción del negocio es requerida.' });
    }

    const systemPromptMeta = `
      Eres un experto Prompt Engineer especialista en arquitectura de IA para asistentes conversacionales y venta directa por WhatsApp.
      
      OBJETIVO:
      Crear una instrucción de sistema (System Prompt) estructurada, profesional y altamente efectiva para entrenar al chatbot de WhatsApp de este cliente.

      DATOS DEL CLIENTE:
      - Descripción del Negocio / Servicio: "${descripcionNegocio}"
      - Objetivo Principal del Bot: "${objetivoBot || 'Atender clientes, resolver dudas y concretar ventas o citas.'}"

      INSTRUCCIONES DE SALIDA:
      Escribe un System Prompt claro, redactado en segunda persona ("Eres un..."). Debe definir:
      1. El rol y personalidad del asistente.
      2. Reglas de comunicación (brevedad para WhatsApp, emojis clave, tono).
      3. Cómo guiar al cliente hacia el objetivo principal.
      
      REGLA CRÍTICA: Devuelve ÚNICAMENTE el texto del System Prompt listo para usar, sin introducciones ni comentarios adicionales.
    `;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: systemPromptMeta }],
      temperature: 0.7,
      max_tokens: 350
    });

    const promptGenerado = completion.choices[0].message.content.trim();
    return res.json({ promptGenerado });

  } catch (error) {
    console.error('Error en /api/generar-system-prompt:', error.message);
    return res.status(500).json({ error: 'Error al generar la instrucción personalizada de IA.' });
  }
});

// ==========================================
// ENDPOINT 1: Analizar Intención en Segundo Plano (Clasificación)
// ==========================================
app.post('/api/analizar-intencion', async (req, res) => {
  try {
    const { cliente, mensaje } = req.body;

    if (!mensaje) {
      return res.status(400).json({ error: 'El parámetro "mensaje" es obligatorio.' });
    }

    const systemPrompt = `
      Eres un clasificador de mensajes de WhatsApp en tiempo real.
      Tu trabajo es analizar el mensaje entrante y determinar la prioridad de atención.

      Criterios de clasificación:
      - "ALTA": El cliente pide precios, métodos de pago, reporta un fallo crítico de soporte, quiere comprar o solicita atención urgente.
      - "MEDIA": Pide información general, hace preguntas frecuentes o dudas sobre características técnicas/servicios.
      - "BAJA": Saludos simples ("Hola", "Buenas"), agradecimientos ("Gracias") o mensajes irrelevantes.

      RESPONDE ÚNICAMENTE EN FORMATO JSON ESTRICTO con el siguiente esquema:
      {
        "prioridad": "ALTA" | "MEDIA" | "BAJA",
        "razon": "Explicación breve de 1 oración de por qué se asignó esta prioridad"
      }
    `;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Mensaje recibido de ${cliente || 'Cliente'}: "${mensaje}"` }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1
    });

    const resultado = JSON.parse(completion.choices[0].message.content);
    return res.json(resultado);

  } catch (error) {
    console.error('Error en /api/analizar-intencion:', error.message);
    return res.status(500).json({
      prioridad: 'BAJA',
      razon: 'Error interno al analizar el mensaje'
    });
  }
});

// ==========================================
// ENDPOINT 2: Generar Respuesta Universal (Con MAPEO DE ROLES Y TONO HUMANO)
// ==========================================
app.post('/api/generar-respuesta', validarLicencia, async (req, res) => {
  try {
    const { 
      mensajeCliente, 
      historialChat, 
      contextoNegocio, 
      promptEntrenamientoUsuario, 
      modoOperacion, 
      tipoAccion, 
      tono 
    } = req.body;

    // 🔎 LOGS DE DEPURACIÓN
    console.log('\n================ DEPURACIÓN DE MEMORIA / HISTORIAL ================');
    console.log('📥 Mensaje actual del cliente:', mensajeCliente);
    console.log('📚 ¿Llegó historialChat?:', historialChat ? `Sí (Elementos: ${historialChat.length})` : 'NO / VACÍO');
    if (historialChat && Array.isArray(historialChat)) {
      console.log('📋 Contenido del historial:', JSON.stringify(historialChat, null, 2));
    }
    console.log('===================================================================\n');

    if (!mensajeCliente) {
      return res.status(400).json({ error: 'El parámetro "mensajeCliente" es obligatorio.' });
    }

    // CASO ESPECIAL: Análisis de Lectura / Explicación
    if (tipoAccion === 'analizar_explicar') {
      let conversacionContexto = '';
      if (historialChat && Array.isArray(historialChat) && historialChat.length > 0) {
        conversacionContexto = `\nHISTORIAL RECIENTE DEL CHAT:\n` + historialChat.map(m => `- ${m.remitente.toUpperCase()}: ${m.texto}`).join('\n');
      }

      const promptExplicacion = `
        Eres un asistente analista de comunicación comercial.
        Analiza el siguiente mensaje entrante y el contexto del chat.
        
        OBJETIVO:
        Explica en MÁXIMO 2 oraciones breves, claras y directas cuál es la intención real, la necesidad, la duda o el problema del cliente.

        ${conversacionContexto}
        Mensaje actual del cliente: "${mensajeCliente}"
      `;

      const completionAnalisis = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: promptExplicacion }],
        temperature: 0.2,
        max_tokens: 150
      });

      return res.json({ respuesta: completionAnalisis.choices[0].message.content.trim() });
    }

    // 1. Configurar Comportamiento según Modo
    let reglaModo = '';
    switch (modoOperacion) {
      case 'soporte':
        reglaModo = `
          ROL: Especialista de Soporte Técnico.
          OBJETIVO: Ayudar al usuario a resolver su problema técnico o duda operativa de forma paciente y resolutiva.
        `;
        break;

      case 'informacion':
        reglaModo = `
          ROL: Asistente de Información General y FAQ.
          OBJETIVO: Responder preguntas sobre servicios, horarios, requisitos y políticas con total claridad.
        `;
        break;

      case 'ventas':
      default:
        let instruccionAccion = '';
        if (tipoAccion === 'rebatir_precio') {
          instruccionAccion = 'El cliente cuestiona el precio. Muestra empatía, resalta el valor percibido y propone un siguiente paso comercial.';
        } else {
          instruccionAccion = 'Dirige al cliente hacia el cierre de venta, agendamiento de cita o el siguiente paso comercial.';
        }

        reglaModo = `
          ROL: Especialista en Ventas y Cierre Comercial por WhatsApp.
          OBJETIVO: ${instruccionAccion}
          INSTRUCCIÓN EXTRA: Si el cliente ya confirmó una cita, aceptó el enlace o cerró la negociación, NO hagas más preguntas. Limítate a confirmar con un mensaje amable, natural y fluido.
        `;
        break;
    }

    // 2. Configurar Instrucciones de Tono
    let instruccionTono = '';
    switch (tono) {
      case 'empatico':
        instruccionTono = 'Usa un tono cálido, amable, comprensivo y cercano.';
        break;
      case 'urgencia':
        instruccionTono = 'Agrega un sentido sutil de escasez o prioridad de atención.';
        break;
      case 'persuasivo':
        instruccionTono = 'Usa un tono altamente persuasivo y enfocado en beneficios de alto valor.';
        break;
      case 'breve':
        instruccionTono = 'Sé extremadamente breve, conciso y directo al grano.';
        break;
      case 'oferta':
        instruccionTono = 'Enfócate en destacar la oferta especial, bonos o descuentos aplicables.';
        break;
      case 'directo':
      default:
        instruccionTono = 'Sé directo, profesional, claro y sin rodeos.';
        break;
    }

    // 3. System Prompt Compuesto con Tono Humano
    const promptUsuarioCustom = promptEntrenamientoUsuario && promptEntrenamientoUsuario.trim().length > 0 
      ? `INSTRUCCIONES DE COMPORTAMIENTO Y ENTRENAMIENTO PERSONALIZADO DEL CLIENTE:\n${promptEntrenamientoUsuario}`
      : `INSTRUCCIONES DE COMPORTAMIENTO:\n${reglaModo}`;

    const infoNegocio = contextoNegocio || CONTEXTO_NEGOCIO_DEFAULT;

    const systemPrompt = `
      ${promptUsuarioCustom}

      CONTEXTO Y DATOS DEL NEGOCIO / OFERTA:
      ${infoNegocio}

      REGLAS DE FORMATO OBLIGATORIAS (ESTRICTO):
      - Tono a aplicar: ${instruccionTono}
      - Longitud: MÁXIMO 2 oraciones cortas. Ve al grano de inmediato.
      - ESTRICTAMENTE PROHIBIDO usar fórmulas corporativas robóticas, frases acartonadas como "¡Un saludo!" al final, ni despedidas corporativas formales de call-center.
      - Si la cita ya quedó confirmada, responde de forma relajada y casual (Ej: "Listo, nos vemos mañana por acá. ¡Cualquier cosa me avisas!").
      - Habla como un asesor experto de carne y hueso conversando por WhatsApp: cercano, fluido, natural y cero robótico.
    `;

    // 4. Construir Mensajes para OpenAI mapeando CORRECTAMENTE roles user / assistant
    let mensajesChatOpenAI = [{ role: 'system', content: systemPrompt }];

    if (historialChat && Array.isArray(historialChat) && historialChat.length > 0) {
      historialChat.forEach(msg => {
        const remitente = (msg.remitente || msg.role || '').toLowerCase();
        const rolOpenAI = (remitente === 'bot' || remitente === 'assistant' || remitente === 'asesor') ? 'assistant' : 'user';
        
        mensajesChatOpenAI.push({
          role: rolOpenAI,
          content: msg.texto || msg.content || '' 
        });
      });

      const ultimoMsgObj = historialChat[historialChat.length - 1];
      const textoUltimo = ultimoMsgObj.texto || ultimoMsgObj.content || '';
      const remitenteUltimo = (ultimoMsgObj.remitente || ultimoMsgObj.role || '').toLowerCase();
      
      const esIgualAlUltimo = textoUltimo.trim() === mensajeCliente.trim() && (remitenteUltimo !== 'bot' && remitenteUltimo !== 'assistant' && remitenteUltimo !== 'asesor');

      if (!esIgualAlUltimo) {
        mensajesChatOpenAI.push({ 
          role: 'user', 
          content: mensajeCliente 
        });
      }
    } else {
      mensajesChatOpenAI.push({ 
        role: 'user', 
        content: mensajeCliente 
      });
    }

    // 🔎 LOG FINAL DE PAYLOAD ENVIADO A OPENAI
    console.log('🤖 Payload final de messages enviado al modelo:', JSON.stringify(mensajesChatOpenAI, null, 2));

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: mensajesChatOpenAI,
      temperature: 0.4, 
      max_tokens: 220
    });

    const respuestaIA = completion.choices[0].message.content.trim();
    return res.json({ respuesta: respuestaIA });

  } catch (error) {
    console.error('Error en /api/generar-respuesta:', error.message);
    return res.status(500).json({ error: 'Ocurrió un error al generar la respuesta de IA.' });
  }
});

// ==========================================
// NUEVO ENDPOINT: Transcribir Audio del Cliente (OpenAI Whisper)
// ==========================================
app.post('/api/transcribir-audio-cliente', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se adjuntó ningún archivo de audio para transcribir.' });
    }

    const audioFile = await OpenAI.toFile(req.file.buffer, 'audio_cliente.ogg', {
      type: req.file.mimetype || 'audio/ogg'
    });

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
    });

    return res.json({ success: true, texto: transcription.text });

  } catch (error) {
    console.error('Error en /api/transcribir-audio-cliente:', error);
    res.status(500).json({ success: false, error: error.message || 'No se pudo procesar el audio del cliente.' });
  }
});

// Ruta para generar audio con la API de OpenAI TTS (Notas de voz)
app.post('/api/generar-audio-ia', async (req, res) => {
  try {
    const { texto } = req.body;
    const apiKey = req.headers['x-user-license'] || process.env.OPENAI_API_KEY;

    if (!texto) {
      return res.status(400).json({ error: 'Falta el texto para convertir a voz.' });
    }

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'tts-1', 
        voice: 'alloy', 
        input: texto,
        response_format: 'opus' // Formato idóneo para notas de voz en WhatsApp Web
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'Error al conectar con OpenAI TTS');
    }

    const audioBuffer = await response.arrayBuffer();

    res.set({
      'Content-Type': 'audio/ogg',
      'Content-Length': audioBuffer.byteLength
    });

    return res.send(Buffer.from(audioBuffer));

  } catch (error) {
    console.error('Error generando audio IA:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// ENDPOINT 3: Resumir Historial de Chat
// ==========================================
app.post('/api/resumir-chat', validarLicencia, async (req, res) => {
  try {
    const { historialChat } = req.body;

    if (!historialChat || !Array.isArray(historialChat)) {
      return res.status(400).json({ error: 'Se requiere un arreglo "historialChat".' });
    }

    const systemPrompt = `
      Eres un asistente analista ejecutivo. Analiza la conversación de WhatsApp y extrae un resumen ultraconciso.
      
      Responde ÚNICAMENTE en formato JSON:
      {
        "interesPrincipal": "Qué producto, servicio o problema presenta",
        "presupuestoOObjecion": "Dudas sobre precio, trabas u objeciones",
        "siguientePaso": "Acción recomendada para el agente"
      }
    `;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Analiza esta conversación:\n${historialChat.map(m => `${m.remitente}: ${m.texto}`).join('\n')}` }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2
    });

    const resumen = JSON.parse(completion.choices[0].message.content);
    return res.json(resumen);

  } catch (error) {
    console.error('Error en /api/resumir-chat:', error.message);
    return res.status(500).json({ error: 'Error al generar el resumen del chat.' });
  }
});

// Endpoint de verificación de estado
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'WhatsApp AI Universal Copilot Backend - Producción MongoDB & PayPal' });
});

// Inicialización del Servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 Servidor AI Copilot corriendo en puerto ${PORT}`);
  console.log(`==================================================\n`);
});

// ==========================================
// AI Copilot Universal - Backend Completo (Node.js / Express + MongoDB + Mercado Pago + Brevo)
// ==========================================

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import crypto from 'crypto';
import multer from 'multer';
import mongoose from 'mongoose';
import { MercadoPagoConfig, PreApproval } from 'mercadopago';

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
  status: { type: String, enum: ['trial', 'active', 'expired', 'inactive'], default: 'trial' },
  usageCount: { type: Number, default: 0 },
  email: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  limiteTokens: { type: Number, default: 7 },
  tokensUsados: { type: Number, default: 0 },
  plan: { type: String, default: 'Prueba Gratuita' }
});
const License = mongoose.model('License', licenseSchema);

// Instancia de OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Instancia de Mercado Pago (Producción / Suscripciones PreApproval)
const mpClient = new MercadoPagoConfig({ 
  accessToken: process.env.MP_ACCESS_TOKEN || 'TU_ACCESS_TOKEN_DE_MERCADO_PAGO' 
});

// Contexto base por defecto si el usuario no configura nada
const CONTEXTO_NEGOCIO_DEFAULT = `
Somos una empresa que ofrece soluciones de software, páginas web, soporte técnico y automatizaciones para negocios.
Ofrecemos atención de alta calidad, acompañamiento continuo y facilidades de acceso.
`;

const USAGE_LIMIT_FREE_TRIAL = 1;

// Helper para generar claves de licencia únicas (ej: PRES-A1B2-C3D4-E5F6 o FREE-A9F4B2)
function generateLicenseKey(prefix = 'PRES') {
  const bytes = crypto.randomBytes(6).toString('hex').toUpperCase();
  const part1 = bytes.substring(0, 4);
  const part2 = bytes.substring(4, 8);
  const part3 = bytes.substring(8, 12);
  return `${prefix}-${part1}-${part2}-${part3}`;
}

// ==========================================
// FUNCIÓN AUXILIAR: Enviar Correo vía Brevo API
// ==========================================
async function enviarCorreoBrevo(destinatarioEmail, licenseKey, asunto = '¡Tu suscripción está activa! Aquí tienes tu Licencia Pro 🚀', contenidoHtml = null) {
  const brevoApiKey = process.env.BREVO_API_KEY;
  
  if (!brevoApiKey) {
    console.warn('⚠️ No se encontró la variable BREVO_API_KEY en el archivo .env. El correo no pudo enviarse.');
    return;
  }

  const htmlFinal = contenidoHtml || `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; border-radius: 8px;">
        <h2 style="color: #4f46e5;">¡Gracias por activar tu suscripción! 🎉</h2>
        <p>Hola,</p>
        <p>Nos alegra confirmar que tu pago se ha procesado con éxito y tu cuenta ya se encuentra en modo <strong>Pro</strong>.</p>
        <p>Tu clave de licencia única para activar la extensión de WhatsApp es:</p>
        <div style="background-color: #e0e7ff; padding: 15px; border-radius: 6px; text-align: center; font-size: 20px; font-weight: bold; color: #3730a3; letter-spacing: 2px; margin: 20px 0;">
          ${licenseKey}
        </div>
        <p>Copia esta clave, pégala en la configuración de tu extensión de Chrome y comienza a disfrutar de todas las funciones automatizadas sin límites.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="font-size: 12px; color: #6b7280;">Si tienes alguna duda o necesitas soporte, responde directamente a este correo.</p>
      </div>
    `;

  const payload = {
    sender: {
      name: process.env.BREVO_SENDER_NAME || 'AI Sales Copilot',
      email: process.env.BREVO_SENDER_EMAIL || 'copilot.ia@prestigecloser.com' // <-- Sustitúyelo aquí
    },
    to: [
      {
        email: destinatarioEmail
      }
    ],
    subject: asunto,
    htmlContent: htmlFinal
  };

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': brevoApiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Error al enviar correo mediante Brevo');
    }

    console.log(`📧 Correo de licencia enviado con éxito a través de Brevo para: ${destinatarioEmail}`);
  } catch (error) {
    console.error('❌ Error al enviar correo con Brevo:', error.message);
  }
}

// ==========================================
// ENDPOINT NUEVO: Generar Prueba Gratuita por Correo
// ==========================================
app.post('/api/generar-prueba', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ success: false, message: 'El correo es obligatorio.' });
    }

    // 1. Verificar si el correo ya pidió su prueba o tiene una licencia
    const licenciaExistente = await License.findOne({ email });
    if (licenciaExistente) {
      return res.status(400).json({ 
        success: false, 
        message: 'Este correo ya cuenta con una licencia o prueba registrada.' 
      });
    }

    // 2. Generar la clave de prueba gratuita
    const licenseKey = generateLicenseKey('FREE');

    // 3. Definir expiración (ej. 30 días o tiempo ilimitado hasta agotar tokens)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // 4. Guardar en MongoDB con el límite de 300 respuestas
    const nuevaLicencia = new License({
      email: email,
      licenseKey: licenseKey,
      status: 'trial',
      plan: 'Prueba Gratuita',
      limiteTokens: 1,
      tokensUsados: 0,
      usageCount: 0,
      expiresAt: expiresAt
    });
    await nuevaLicencia.save();

    // 5. Enviar el correo con la clave de prueba
    const htmlContenido = `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; border-radius: 8px;">
            <h2 style="color: #28a745;">¡Bienvenido a Copilot.ai! 🚀</h2>
            <p>Has solicitado tu prueba gratuita de 300 respuestas.</p>
            <p>Tu clave de activación única es:</p>
            <div style="background-color: #e8f5e9; padding: 15px; border-radius: 6px; text-align: center; font-size: 20px; font-weight: bold; color: #2e7d32; letter-spacing: 2px; margin: 20px 0;">
              ${licenseKey}
            </div>
            <p>Copia y pega esta clave en la extensión de Chrome para activar tu cuenta de prueba.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
            <p style="font-size: 12px; color: #6b7280;">Al agotar tus respuestas, podrás adquirir un plan Pro para seguir disfrutando del servicio.</p>
        </div>
    `;

    await enviarCorreoBrevo(email, licenseKey, 'Tu clave de prueba gratuita para Copilot.ai 🎁', htmlContenido);

    return res.json({ 
      success: true, 
      message: '¡Prueba creada! Revisa tu correo para obtener tu clave.' 
    });

  } catch (error) {
    console.error('Error generando prueba gratuita:', error);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
});

// ==========================================
// CONFIGURACIÓN MODO DESARROLLADOR / PRUEBAS
// ==========================================
const DEV_MASTER_KEY = "DEV-PRO-2026-UNLIMITED";

// ==========================================
// MIDDLEWARE: Validación de Licencia / Free Trial en MongoDB
// ==========================================
async function validarLicencia(req, res, next) {
  const rawLicenseKey = req.headers['x-user-license'] || 'TRIAL_KEY';
  const licenseKey = rawLicenseKey.trim();

  // ------------------------------------------------------------------
  // ⚡ MODO PRUEBAS: Bypass idéntico a una Suscripción Pro Activa
  // ------------------------------------------------------------------
  if (licenseKey === DEV_MASTER_KEY) {
    req.userLicenseDoc = {
      licenseKey: DEV_MASTER_KEY,
      status: 'active',
      plan: 'Pro (Mercado Pago)',
      limiteTokens: 999999,
      tokensUsados: 0,
      save: async () => {} // Función dummy vacía
    };
    return next();
  }
  // ------------------------------------------------------------------

  let user = await License.findOne({ licenseKey });

  // 1. Si la licencia NO existe en absoluto en la base de datos
  if (!user) {
    if (licenseKey === 'TRIAL_KEY') {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      user = await License.create({
        licenseKey,
        status: 'trial',
        usageCount: 0,
        limiteTokens: USAGE_LIMIT_FREE_TRIAL,
        tokensUsados: 0,
        email: 'trial_user@system.local',
        expiresAt
      });
    } else {
      return res.status(403).json({
        error: '❌ No encontramos una suscripción activa o clave válida con este dato en el sistema.',
        code: 'INVALID_LICENSE'
      });
    }
  }

  // 2. Si la licencia SÍ existe, procedemos a validar su estado de vigencia
  if (user.status === 'trial') {
    const totalUsado = user.tokensUsados !== undefined ? user.tokensUsados : user.usageCount;
    const limiteActual = user.limiteTokens || USAGE_LIMIT_FREE_TRIAL;

    if (totalUsado >= limiteActual) {
      return res.status(403).json({
        error: `Has agotado tus ${limiteActual} respuestas de prueba. ¡Adquiere un plan en nuestra web para continuar!`,
        code: 'TRIAL_EXPIRED',
        limiteAgotado: true
      });
    }
  } else if (user.status === 'active' || user.status === 'suscrito') {
    if (user.expiresAt && new Date(user.expiresAt) < new Date()) {
      user.status = 'expired';
      await user.save();
      return res.status(403).json({
        error: 'Tu suscripción ha expirado. Por favor renueva tu plan en la web.',
        code: 'SUBSCRIPTION_EXPIRED'
      });
    }
  } else {
    return res.status(403).json({ 
      error: 'Tu suscripción no está activa o se encuentra pausada. Renueva tu plan para seguir operando.',
      code: 'SUBSCRIPTION_INACTIVE'
    });
  }

  req.userLicenseDoc = user;
  next();
}

// ==========================================
// ENDPOINT B2B: Crear Suscripción Recurrente Corporativa (Mercado Pago Preapproval)
// ==========================================
app.post('/api/admin/crear-checkout-b2b', async (req, res) => {
  try {
    const { empresaNombre, emailContacto, cantidadLicencias, precioTotalUSD, adminSecret } = req.body;

    if (adminSecret !== (process.env.ADMIN_SECRET || 'mi_clave_secreta_super_segura_2026')) {
      return res.status(403).json({ success: false, error: 'No autorizado.' });
    }

    if (!emailContacto || !cantidadLicencias || !precioTotalUSD) {
      return res.status(400).json({ success: false, error: 'Faltan parámetros obligatorios para la cotización B2B.' });
    }

    // Obtener tasa de cambio USD a COP (o puedes manejarlo directamente en USD si tu cuenta lo soporta)
    let tasaCambio = 4000;
    try {
      const responseTasa = await fetch('https://open.er-api.com/v6/latest/USD');
      if (responseTasa.ok) {
        const dataTasa = await responseTasa.json();
        if (dataTasa?.rates?.COP) tasaCambio = dataTasa.rates.COP;
      }
    } catch (e) {
      console.warn('Usando tasa de cambio por defecto.');
    }

    const precioFinalCOP = Math.round(Number(precioTotalUSD) * tasaCambio);
    const backendUrl = process.env.BACKEND_URL || 'https://copilot-ia-backend.onrender.com';
    const frontendUrl = process.env.FRONTEND_URL || 'https://copilot.prestigecloser.com';

    // Crear suscripción PreApproval en Mercado Pago para la empresa
    const preApproval = new PreApproval(mpClient);
    const result = await preApproval.create({
      body: {
        reason: `Plan Empresarial B2B - ${empresaNombre} (${cantidadLicencias} Cuentas)`,
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months', // Cobro mensual recurrente
          transaction_amount: Number(precioFinalCOP),
          currency_id: 'COP'
        },
        back_url: `${frontendUrl}/gracias.html`,
        payer_email: emailContacto,
        status: 'pending',
        // Pasamos metadata o parámetros en el external_reference para identificar el pedido en el Webhook
        external_reference: JSON.stringify({
          tipo: 'b2b',
          empresaNombre,
          cantidadLicencias: Number(cantidadLicencias)
        }),
        notification_url: `${backendUrl}/api/webhook-mercadopago`
      }
    });

    console.log(`🔗 [B2B CHECKOUT] Enlace de pago generado para ${empresaNombre}: ${result.init_point}`);
    return res.json({ success: true, init_point: result.init_point });

  } catch (error) {
    console.error('❌ Error al crear checkout B2B:', error.message);
    return res.status(500).json({ success: false, error: 'Error al procesar la suscripción corporativa.' });
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
      Escribe un experto Prompt Engineer especialista en arquitectura de IA para asistentes conversacionales y venta directa por WhatsApp.
      
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
// ENDPOINT PASARELA DE PAGOS: Crear Suscripción Recurrente (Mercado Pago Preapproval)
// ==========================================
app.post('/api/crear-checkout', async (req, res) => {
  try {
    const { email, plan } = req.body; // plan: 'mensual' ($15) o 'anual' ($120)
    const precio = plan === 'anual' ? 120 : 15;
    const frecuencia = 1;
    const frecuenciaTipo = plan === 'anual' ? 'years' : 'months';

    const frontendUrl = process.env.FRONTEND_URL || 'https://copilot.prestigecloser.com';
    const backendUrl = process.env.BACKEND_URL || 'https://copilot-ia-backend.onrender.com';

    const preApproval = new PreApproval(mpClient);
    const result = await preApproval.create({
      body: {
        reason: `AI Sales Copilot - Suscripción ${(plan || 'mensual').toUpperCase()}`,
        auto_recurring: {
          frequency: frecuencia,
          frequency_type: frecuenciaTipo,
          transaction_amount: Number(precio),
          currency_id: 'USD'
        },
        back_url: `${frontendUrl}/gracias.html`,
        payer_email: email || 'cliente@desconocido.com',
        status: 'pending',
        notification_url: `${backendUrl}/api/webhook-mercadopago`
      }
    });

    res.json({ init_point: result.init_point });
  } catch (error) {
    console.error('Error al crear suscripción de Mercado Pago:', error.message);
    res.status(500).json({ error: 'Error al procesar la solicitud de suscripción.' });
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
      Escribes un clasificador de mensajes de WhatsApp en tiempo real.
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
// ENDPOINT 2: Generar Respuesta Universal (Con Mensajes Personalizados por Tipo de Licencia)
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

    // 🛡️ VALIDACIÓN Y DIFERENCIACIÓN SEGÚN TIPO DE PLAN / LICENCIA
    if (req.userLicenseDoc) {
      const tipoLicencia = (req.userLicenseDoc.tipo || req.userLicenseDoc.status || 'trial').toLowerCase();
      const tokensUsados = req.userLicenseDoc.tokensUsados !== undefined ? req.userLicenseDoc.tokensUsados : (req.userLicenseDoc.usageCount || 0);
      const limiteTokens = req.userLicenseDoc.limiteTokens !== undefined ? req.userLicenseDoc.limiteTokens : 20;

      // 1. Si es TRIAL y agotó sus tokens gratuitos
      if (tipoLicencia === 'trial' && tokensUsados >= limiteTokens) {
        return res.status(403).json({
          code: 'TRIAL_EXPIRED',
          error: 'Has consumido todos tus mensajes de prueba gratuita. Activa el Plan Starter o Pro para seguir automatizando tus ventas sin límites.'
        });
      }

      // 2. Si es STARTER y agotó sus tokens del mes
      if (tipoLicencia === 'starter' && tokensUsados >= limiteTokens) {
        return res.status(403).json({
          code: 'STARTER_EXPIRED',
          error: 'Has alcanzado el límite de mensajes de tu Plan Starter este mes. Actualiza al Plan Pro o renueva tu ciclo para continuar.'
        });
      }

      // 3. Si es PRO y agotó sus tokens del mes
      if (tipoLicencia === 'pro' && tokensUsados >= limiteTokens) {
        return res.status(403).json({
          code: 'PRO_EXPIRED',
          error: 'Has llegado al límite de mensajes permitidos en tu Plan Pro para este período. Contacta con soporte o adquiere una recarga.'
        });
      }

      // 4. Si la suscripción general está vencida, inactiva o suspendida
      if (tipoLicencia === 'expired' || tipoLicencia === 'inactive' || req.userLicenseDoc.suspended) {
        return res.status(403).json({
          code: 'SUBSCRIPTION_EXPIRED',
          error: 'Tu suscripción mensual se encuentra inactiva o pendiente de pago. Ponte al día para seguir usando Copilot.AI.'
        });
      }
    }

    // CASO ESPECIAL: Análisis de Lectura / Explicación
    if (tipoAccion === 'analizar_explicar') {
      let conversacionContexto = '';
      if (historialChat && Array.isArray(historialChat) && historialChat.length > 0) {
        conversacionContexto = `\nHISTORIAL RECIENTE DEL CHAT:\n` + historialChat.map(m => `- ${m.remitente.toUpperCase()}: ${m.texto}`).join('\n');
      }

      const promptExplicacion = `
        Escribes un asistente analista de comunicación comercial.
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
          INSTRUCCIÓN EXTRA: Si el cliente ya confirmó una cita, aceptó el enlace o cerró la negociación, NO hagas más preguntas. Limítate a confirmar con un mensaje amable, directo y profesional (ej: "Perfecto, quedamos agendados. ¡Un saludo!"). Si la conversación sigue abierta, termina con un llamado a la acción directo.
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

    // 3. System Prompt Compuesto
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
      - Si la cita ya quedó confirmada, responde de forma relajada y casual (Ej: "Listo, nos vemos mañana a las 3 PM por acá. ¡Cualquier cosa me avisas!").
      - Habla como un asesor experto de carne y hueso conversando por WhatsApp: cercano, fluido, natural y cero robótico.
    `;

    // 4. Construir Mensajes para OpenAI mapeando CORRECTAMENTE roles user / assistant
    let mensajesChatOpenAI = [{ role: 'system', content: systemPrompt }];

    if (historialChat && Array.isArray(historialChat) && historialChat.length > 0) {
      historialChat.forEach(msg => {
        const remitente = (msg.remitente || msg.role || '').toLowerCase();
        
        // CORRECCIÓN CRÍTICA DE ROLES: 
        // Si el remitente es 'bot', 'assistant' o 'asesor', va como 'assistant'. 
        // Todo lo demás (cliente, user, etc.) va como 'user'.
        const rolOpenAI = (remitente === 'bot' || remitente === 'assistant' || remitente === 'asesor') ? 'assistant' : 'user';
        
        mensajesChatOpenAI.push({
          role: rolOpenAI,
          content: msg.texto || msg.content || '' 
        });
      });

      // Verificar si el último mensaje del historial ya coincide con el mensajeCliente actual
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
    console.log('🤖 Payload final de messages enviado a OpenAI:', JSON.stringify(mensajesChatOpenAI, null, 2));

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: mensajesChatOpenAI,
      temperature: 0.4, 
      max_tokens: 220
    });

    const respuestaIA = completion.choices[0].message.content.trim();

    // 🎯 INCREMENTO ÚNICO Y SEGURO DE CONTADOR EN TRIAL / PLANES
    if (req.userLicenseDoc) {
      const currentTokens = req.userLicenseDoc.tokensUsados !== undefined ? req.userLicenseDoc.tokensUsados : (req.userLicenseDoc.usageCount || 0);
      req.userLicenseDoc.tokensUsados = currentTokens + 1;
      req.userLicenseDoc.usageCount = req.userLicenseDoc.tokensUsados;
      await req.userLicenseDoc.save();
    }

    return res.json({ respuesta: respuestaIA });

  } catch (error) {
    console.error('Error en /api/generar-respuesta:', error.message);
    return res.status(500).json({ error: 'Ocurrió un error al generar la respuesta de IA.' });
  }
});

const axios = require('axios');

// Endpoint para recuperar el link de pago/actualización de una suscripción existente
app.post('/api/admin/obtener-link-suscripcion', async (req, httpRes) => {
  try {
    const { adminSecret, emailContacto } = req.body;

    if (adminSecret !== process.env.ADMIN_SECRET) {
      return httpRes.status(401).json({ success: false, error: "No autorizado" });
    }

    // 1. Consultar a la API de Mercado Pago las pre-aprobaciones (suscripciones) filtrando por correo
    const mpResponse = await axios.get(`https://api.mercadopago.com/preapproval/search`, {
      headers: {
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`
      },
      params: {
        payer_email: emailContacto,
        status: 'authorized' // O 'pending' si el pago falló y está pendiente de reintento
      }
    });

    const suscripciones = mpResponse.data.results;

    if (!suscripciones || suscripciones.length === 0) {
      return httpRes.status(404).json({ 
        success: false, 
        error: "No se encontró ninguna suscripción activa o pendiente para este correo." 
      });
    }

    // Tomamos la suscripción más reciente de ese cliente
    const suscripcionActiva = suscripciones[0];
    
    // Mercado Pago devuelve la URL de init_point (o el link de pago de la suscripción)
    const linkPagoExistente = suscripcionActiva.init_point;

    return httpRes.json({
      success: true,
      init_point: linkPagoExistente,
      status: suscripcionActiva.status,
      idSuscripcion: suscripcionActiva.id
    });

  } catch (error) {
    console.error("Error al buscar suscripción en MP:", error.response?.data || error.message);
    return httpRes.status(500).json({ success: false, error: "Error al consultar la API de Mercado Pago" });
  }
});

// ==========================================
// ENDPOINT NUEVO: Crear Licencias de Feedback (Admin)
// ==========================================
app.post('/api/admin/crear-licencia-feedback', async (req, res) => {
  console.log('📥 [BACKEND] Petición recibida en /api/admin/crear-licencia-feedback');
  console.log('📦 [BACKEND] Body recibido:', req.body);

  try {
    const { email, durationDays, maxActivations, adminSecret } = req.body;

    // Validar contraseña de administrador
    if (adminSecret !== (process.env.ADMIN_SECRET || 'mi_clave_secreta_super_segura_2026')) {
      console.warn('❌ [BACKEND] Intento de acceso no autorizado con secret:', adminSecret);
      return res.status(403).json({ success: false, error: 'No autorizado. Admin secret incorrecto.' });
    }

    if (!email || !durationDays || !maxActivations) {
      console.warn('❌ [BACKEND] Faltan parámetros en la petición.');
      return res.status(400).json({ success: false, error: 'Faltan parámetros (email, durationDays, maxActivations).' });
    }

    const licenseKey = generateLicenseKey('FB');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + Number(durationDays));

    const nuevaLicencia = new License({
      licenseKey,
      email,
      status: 'active',
      durationDays: Number(durationDays),
      maxActivations: Number(maxActivations),
      currentActivations: 0,
      limiteTokens: 999999,
      plan: `Feedback ${durationDays} Días (${maxActivations === 1 ? 'Individual' : `Grupal ${maxActivations}`})`,
      expiresAt
    });

    await nuevaLicencia.save();
    console.log(`✅ [BACKEND] Licencia creada y guardada en MongoDB: ${licenseKey} para ${email}`);

    // Enviar correo automático con Brevo
    try {
      const htmlContenido = `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; border-radius: 8px;">
          <h2 style="color: #4f46e5;">¡Acceso Exclusivo de Feedback - Copilot.ai! 🚀</h2>
          <p>Hola,</p>
          <p>Te hemos seleccionado para probar en primicia nuestra extensión y ayudarnos con tu feedback estratégico.</p>
          <p>Tu clave de acceso (${durationDays} días, hasta ${maxActivations} cuentas) es:</p>
          <div style="background-color: #e0e7ff; padding: 15px; border-radius: 6px; text-align: center; font-size: 20px; font-weight: bold; color: #3730a3; letter-spacing: 2px; margin: 20px 0;">
            ${licenseKey}
          </div>
          <p>Copia esta clave y pégala en la configuración de tu extensión.</p>
        </div>
      `;
      await enviarCorreoBrevo(email, licenseKey, 'Tu acceso exclusivo de feedback 🎁', htmlContenido);
    } catch (mailErr) {
      console.warn('⚠️ [BACKEND] La licencia se creó pero falló el envío de correo:', mailErr.message);
    }

    return res.json({ 
      success: true, 
      message: 'Licencia de feedback creada con éxito.', 
      licenseKey,
      details: { durationDays, maxActivations, expiresAt }
    });

  } catch (error) {
    console.error('❌ [BACKEND ERROR] Error interno procesando licencia:', error);
    return res.status(500).json({ success: false, error: error.message || 'Error interno del servidor.' });
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
// RUTA: /api/crear-preferencia-mp
// ==========================================
app.post('/api/crear-preferencia-mp', async (req, res) => {
  try {
    const { email, plan } = req.body;
    
    // 1. Definir precios y límites según el plan elegido
    let precioUSD = 10; // Plan Starter por defecto ($10 USD / mes)[cite: 4]
    let frecuencia = 1;
    let frecuenciaTipo = 'months';
    let limiteRespuestasDia = 200;
    let incluyeAudio = false;

    if (plan === 'pro') {
      precioUSD = 59; // Plan Pro / Completo ($59 USD / mes)[cite: 4]
      frecuencia = 1;
      frecuenciaTipo = 'months';
      limiteRespuestasDia = 999999; // Ilimitado[cite: 4]
      incluyeAudio = true;
    }

    // 2. Obtener la tasa de cambio actual USD a COP automáticamente
    let tasaCambio = 4000; // Valor de respaldo (Fallback)[cite: 4]
    try {
      const responseTasa = await fetch('https://open.er-api.com/v6/latest/USD');
      if (responseTasa.ok) {
        const dataTasa = await responseTasa.json();
        if (dataTasa && dataTasa.rates && dataTasa.rates.COP) {
          tasaCambio = dataTasa.rates.COP;
        }
      }
    } catch (errTasa) {
      console.warn('No se pudo actualizar la tasa del dólar, usando valor de respaldo:', errTasa.message);
    }

    // 3. Calcular el precio final en Pesos Colombianos (COP) redondeado
    const precioFinalCOP = Math.round(precioUSD * tasaCambio);

    const frontendUrl = process.env.FRONTEND_URL || 'https://copilot.prestigecloser.com';
    const backendUrl = process.env.BACKEND_URL || 'https://copilot-ia-backend.onrender.com';

    // 4. Crear la suscripción recurrente mediante PreApproval de Mercado Pago
    const preApproval = new PreApproval(mpClient);
    const result = await preApproval.create({
      body: {
        reason: `AI Sales Copilot - Suscripción ${(plan || 'starter').toUpperCase()} ($${precioUSD} USD)`,
        auto_recurring: {
          frequency: frecuencia,
          frequency_type: frecuenciaTipo,
          transaction_amount: Number(precioFinalCOP),
          currency_id: 'COP'
        },
        back_url: `${frontendUrl}/gracias.html`,
        payer_email: email || 'cliente@desconocido.com',
        status: 'pending',
        notification_url: `${backendUrl}/api/webhook-mercadopago`
      }
    });

    res.json({ 
      init_point: result.init_point,
      planConfig: {
        limiteRespuestasDia,
        incluyeAudio
      }
    });
  } catch (error) {
    console.error('Error al crear preferencia de Mercado Pago:', error.message);
    res.status(500).json({ error: 'Error al procesar la solicitud de suscripción.' });
  }
});

app.get('/api/verificar-suscripcion', async (req, res) => {
  const { id } = req.query; // Puede ser el email o la licenseKey del usuario

  // ------------------------------------------------------------------
  // ⚡ MODO PRUEBAS: Respuesta idéntica a Plan Pro si se usa la Key Maestra
  // ------------------------------------------------------------------
  if (id && id.trim() === DEV_MASTER_KEY) {
    return res.json({ 
      valida: true,
      activo: true, 
      plan: 'pro',
      tokensRestantes: 999999,
      incluyeAudio: true,
      limiteRespuestasDia: 999999
    });
  }
  // ------------------------------------------------------------------

  try {
    const usuarioBD = await License.findOne({ 
      $or: [{ email: id }, { licenseKey: id }] 
    });

    if (usuarioBD && (usuarioBD.status === 'active' || usuarioBD.status === 'trial')) {
      const limite = usuarioBD.limiteTokens || USAGE_LIMIT_FREE_TRIAL;
      const usados = usuarioBD.tokensUsados !== undefined ? usuarioBD.tokensUsados : usuarioBD.usageCount;
      
      if (usuarioBD.status === 'trial' && usados >= limite) {
        return res.json({ 
          activo: false, 
          limiteAgotado: true,
          error: 'Has agotado tus respuestas de prueba.'
        });
      }

      return res.json({ 
        valida: true,
        activo: true, 
        plan: usuarioBD.plan || (usuarioBD.status === 'trial' ? 'Prueba Gratuita' : 'pro'),
        tokensRestantes: limite - usados
      });
    }

    return res.json({ valida: false, activo: false, error: 'Clave no encontrada o inactiva.' });
  } catch (error) {
    console.error('Error verificando suscripción:', error.message);
    res.status(500).json({ valida: false, error: 'Error verificando suscripción' });
  }
});

// ==========================================
// ENDPOINT WEBHOOK: Mercado Pago + Brevo (Integrado con B2B y Usuarios Individuales)
// ==========================================
app.post('/api/webhook-mercadopago', async (req, res) => {
  try {
    const event = req.body;
    console.log('🔔 Webhook de Mercado Pago recibido:', event.type || event.action);

    const preapprovalId = event.data?.id || event.id;

    if (preapprovalId) {
      const preApproval = new PreApproval(mpClient);
      const subscriptionInfo = await preApproval.get({ id: preapprovalId });

      if (subscriptionInfo) {
        const payerEmail = subscriptionInfo.payer_email;
        const status = subscriptionInfo.status; // 'authorized', 'paused', 'cancelled', etc.

        // 1. SI ESTÁ AUTORIZADO (PAGO EXITOSO O NUEVA SUSCRIPCIÓN)
        if (status === 'authorized') {
          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + 35); // Extiende 35 días

          // Verificar si trae datos corporativos en el external_reference
          let datosB2B = null;
          try {
            if (subscriptionInfo.external_reference) {
              datosB2B = JSON.parse(subscriptionInfo.external_reference);
            }
          } catch (e) {
            // No es B2B, es una suscripción regular o estándar
          }

          if (datosB2B && datosB2B.tipo === 'b2b') {
            // 🏢 CASO B2B: Generar Licencia Matriz con Múltiples Activaciones
            const newLicenseKey = generateLicenseKey('B2B');
            const nuevaLicenciaCorporativa = new License({
              licenseKey: newLicenseKey,
              status: 'active',
              plan: `Empresarial B2B - ${datosB2B.empresaNombre} (${datosB2B.cantidadLicencias} Cuentas)`,
              usageCount: 0,
              tokensUsados: 0,
              limiteTokens: 999999,
              maxActivations: Number(datosB2B.cantidadLicencias), // <--- Límite de puestos permitidos para la empresa
              currentActivations: 0,
              email: payerEmail || 'suscriptor_b2b@local',
              expiresAt
            });

            await nuevaLicenciaCorporativa.save();
            console.log(`✅ [WEBHOOK B2B] Licencia corporativa creada para ${datosB2B.empresaNombre} -> Key: ${newLicenseKey} (${datosB2B.cantidadLicencias} puestos)`);

            // 📧 ENVÍO DE CORREO CORPORATIVO VÍA BREVO PARA B2B
            if (payerEmail && payerEmail !== 'suscriptor_b2b@local') {
              const htmlB2B = `
                <div style="font-family: Arial, sans-serif; padding: 25px; color: #333; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px;">
                  <h2 style="color: #1e40af;">¡Suscripción Empresarial B2B Activada, ${datosB2B.empresaNombre}! 🏢</h2>
                  <p>Hola, su pago recurrente corporativo se ha procesado con éxito.</p>
                  <p>Su clave de licencia corporativa exclusiva para <strong>${datosB2B.cantidadLicencias} puestos de trabajo</strong> es:</p>
                  <div style="background-color: #eff6ff; padding: 15px; border-radius: 6px; text-align: center; font-size: 22px; font-weight: bold; color: #1e3a8a; letter-spacing: 2px; margin: 20px 0;">
                    ${newLicenseKey}
                  </div>
                  <p>Comparta esta misma clave con los miembros de su equipo para que la activen simultáneamente en sus extensiones de Chrome.</p>
                  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
                  <p style="font-size: 12px; color: #6b7280;">Soporte técnico prioritario incluido durante su suscripción activa.</p>
                </div>
              `;
              await enviarCorreoBrevo(payerEmail, newLicenseKey, `Tu Licencia Corporativa B2B - ${datosB2B.empresaNombre} 🚀`, htmlB2B);
            }

          } else {
            // 👤 CASO INDIVIDUAL (Tu código original intacto)
            let usuario = await License.findOne({ email: payerEmail });

            if (usuario) {
              usuario.status = 'active';
              usuario.plan = 'Pro (Mercado Pago)';
              usuario.expiresAt = expiresAt;
              await usuario.save();
              console.log(`✅ Suscripción renovada/activada para: ${payerEmail}`);
            } else {
              const newLicenseKey = generateLicenseKey('PRES');
              await License.create({
                licenseKey: newLicenseKey,
                status: 'active',
                plan: 'Pro (Mercado Pago)',
                usageCount: 0,
                tokensUsados: 0,
                limiteTokens: 999999,
                email: payerEmail || 'suscriptor_mercadopago@local',
                expiresAt
              });
              console.log(`✅ Nueva licencia creada para: ${payerEmail} -> Key: ${newLicenseKey}`);
              
              // 📧 ENVÍO DE CORREO AUTOMÁTICO VÍA BREVO PARA NUEVOS SUSCRIPTORES
              if (payerEmail && payerEmail !== 'suscriptor_mercadopago@local') {
                await enviarCorreoBrevo(payerEmail, newLicenseKey);
              }
            }
          }
        } 
        
        // 2. SI LA SUSCRIPCIÓN SE PAUSÓ O CANCELÓ (FALTA DE PAGO)
        else if (status === 'paused' || status === 'cancelled') {
          await License.updateMany(
            { email: payerEmail },
            { $set: { status: 'inactive' } }
          );
          console.log(`❌ Suscripción pausada/cancelada por impago para: ${payerEmail}. Acceso bloqueado.`);
        }
      }
    }

    res.status(200).send('Webhook procesado correctamente');
  } catch (error) {
    console.error('Error procesando webhook de Mercado Pago:', error.message);
    res.status(500).json({ error: 'Error procesando webhook' });
  }
});

app.get('/api/validar-licencia', async (req, res) => {
  try {
    const rawLicenseKey = req.headers['x-user-license'];
    const licenseKey = rawLicenseKey ? rawLicenseKey.trim() : '';

    // ------------------------------------------------------------------
    // ⚡ MODO PRUEBAS: Devuelve el mismo estado de un usuario Pro
    // ------------------------------------------------------------------
    if (licenseKey === DEV_MASTER_KEY) {
      return res.json({ 
        activo: true, 
        plan: 'pro', 
        mensaje: 'Licencia Pro activa (Dev)',
        limiteRespuestasDia: 999999,
        incluyeAudio: true
      });
    }
    // ------------------------------------------------------------------

    if (!licenseKey || licenseKey === 'TRIAL_KEY') {
      return res.status(401).json({ 
        activo: false, 
        plan: 'trial', 
        mensaje: 'Licencia de prueba o inválida' 
      });
    }

    const usuarioBD = await License.findOne({ licenseKey });
    if (!usuarioBD) {
      return res.status(403).json({ activo: false, mensaje: 'Licencia no encontrada' });
    }

    const limite = usuarioBD.limiteTokens || USAGE_LIMIT_FREE_TRIAL;
    const usados = usuarioBD.tokensUsados !== undefined ? usuarioBD.tokensUsados : usuarioBD.usageCount;

    if (usuarioBD.status === 'trial' && usados >= limite) {
      return res.status(403).json({ 
        activo: false, 
        limiteAgotado: true,
        mensaje: 'Has agotado tus respuestas de prueba gratuitas' 
      });
    }

    if (usuarioBD.status === 'active' || usuarioBD.status === 'trial') {
      return res.json({ 
        activo: true, 
        plan: usuarioBD.plan || 'pro', 
        mensaje: 'Licencia activa' 
      });
    } else {
      return res.status(403).json({ 
        activo: false, 
        mensaje: 'Licencia vencida o inactiva' 
      });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error al validar licencia' });
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
      Escribe un asistente analista ejecutivo. Analiza la conversación de WhatsApp y extrae un resumen ultraconciso.
      
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
  res.json({ status: 'ok', service: 'WhatsApp AI Universal Copilot Backend (MongoDB, Mercado Pago & Brevo)' });
});

// Inicialización del Servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 Servidor AI Copilot corriendo en puerto ${PORT}`);
  console.log(`==================================================\n`);
});

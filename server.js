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
import cron from 'node-cron';
import axios from 'axios';
import 'dotenv/config';
import nodemailer from 'nodemailer';

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
  plan: { type: String, default: 'Prueba Gratuita' },
  preapprovalId: { type: String }, // Identificador de la suscripción recurrente en Mercado Pago
  cancelAt: { type: Date },       // Fecha límite programada para cancelar
  estadoCancelacionProgramada: { type: String, enum: ['PENDIENTE', 'EJECUTADA'], default: null } // Estado del cron de cancelación
});
const License = mongoose.model('License', licenseSchema);

// Esquema para las cotizaciones B2B
const leadEmpresaSchema = new mongoose.Schema({
  empresa: { type: String, required: true },
  contacto: { type: String, required: true },
  email: { type: String, required: true },
  telefono: { type: String, required: true },
  licencias: { type: String },
  pais: { type: String },
  mensaje: { type: String },
  fecha: { type: Date, default: Date.now }
});

// ==========================================
// DEFINICIÓN DE MODELOS DE MONGOOSE
// ==========================================
const Suscriptor = mongoose.models.Suscriptor || mongoose.model('Suscriptor', new mongoose.Schema({
    fecha: { type: Date, default: Date.now },
    nombre: String,
    email: String,
    plan: String,
    monto: Number,
    estado: String // 'Activo', 'Pausado', 'Cancelado'
}));

const LeadEmpresa = mongoose.models.LeadEmpresa || mongoose.model('LeadEmpresa', leadEmpresaSchema);

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


// ... (Aquí van todas tus rutas y endpoints actuales) ...



// Helper para generar claves de licencia únicas (ej: PRES-A1B2-C3D4-E5F6 o FREE-A9F4B2)
function generateLicenseKey(prefix = 'PRES') {
  const bytes = crypto.randomBytes(6).toString('hex').toUpperCase();
  const part1 = bytes.substring(0, 4);
  const part2 = bytes.substring(4, 8);
  const part3 = bytes.substring(8, 12);
  return `${prefix}-${part1}-${part2}-${part3}`;
}

// ==========================================
// FUNCIÓN AUXILIAR: Enviar Correo vía Brevo API (Acepta 1 o varios destinatarios)
// ==========================================
async function enviarCorreoBrevo(destinatarios, licenseKey, asunto = '¡Tu suscripción está activa! Aquí tienes tu Licencia Pro 🚀', contenidoHtml = null) {
  const brevoApiKey = process.env.BREVO_API_KEY;
  
  if (!brevoApiKey) {
    console.warn('⚠️ No se encontró la variable BREVO_API_KEY en el archivo .env. El correo no pudo enviarse.');
    return;
  }

  // Normalizar destinatarios: Si viene un solo string, lo convierte en Array
  const emailsArray = Array.isArray(destinatarios) ? destinatarios : [destinatarios];
  
  // Limpiar y estructurar lista para Brevo
  const toList = emailsArray
    .filter(email => email && !email.includes('@local')) // Filtrar correos ficticios
    .map(email => ({ email: email.trim() }));

  if (toList.length === 0) {
    console.warn('⚠️ No hay correos válidos en la lista de destinatarios.');
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
      email: process.env.BREVO_SENDER_EMAIL || 'copilot.ia@prestigecloser.com'
    },
    to: toList,
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

    console.log(`📧 Correo enviado con éxito a: ${toList.map(t => t.email).join(', ')}`);
  } catch (error) {
    console.error('❌ Error al enviar correo con Brevo:', error.message);
  }
}



// ==========================================
// ENDPOINT: Generar Prueba Gratuita por Correo
// ==========================================
app.post('/api/generar-prueba', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ success: false, message: 'El correo es obligatorio.' });
    }

    // 1. Verificar si el correo ya pidió su prueba o tiene una licencia
    const licenciaExistente = await License.findOne({ email: email.trim().toLowerCase() });
    if (licenciaExistente) {
      return res.status(400).json({ 
        success: false, 
        message: 'Este correo ya cuenta con una licencia o prueba registrada.' 
      });
    }

    // 2. Generar la clave de prueba gratuita
    const licenseKey = generateLicenseKey('FREE');

    // 3. Definir expiración (30 días de vigencia)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // 4. Guardar en MongoDB con el límite de 300 respuestas
    const nuevaLicencia = new License({
      email: email.trim().toLowerCase(),
      licenseKey: licenseKey,
      status: 'trial',
      plan: 'Prueba Gratuita',
      limiteTokens: 1, // Ajustado a 300 respuestas de límite
      tokensUsados: 0,
      usageCount: 0,
      expiresAt: expiresAt
    });
    await nuevaLicencia.save();

    // 5. Enviar el correo con la clave de prueba
    const logoUrl = process.env.LOGO_URL || 'https://lh3.googleusercontent.com/d/1GtxY0-91lcxLod1uEqtQCpVJSdWInUgk';

    const htmlContenido = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; background-color: #f4f6f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; -webkit-font-smoothing: antialiased;">
          
          <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f4f6f9; padding: 30px 0;">
            <tr>
              <td align="center">
                
                <!-- Contenedor Principal -->
                <table border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
                  
                  <!-- HEADER / CABECERA CON LOGO -->
                  <tr>
                    <td align="center" style="background-color: #0f172a; padding: 25px 20px;">
                      <img src="${logoUrl}" alt="Copilot.ai" width="350" style="display: block; border: 0; max-width: 90%; height: auto;">
                    </td>
                  </tr>

                  <!-- BANNER PRUEBA GRATUITA -->
                  <tr>
                    <td style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); padding: 25px 30px; text-align: center; color: #ffffff;">
                      <h1 style="margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">¡Bienvenido a Copilot.ai! 🚀</h1>
                      <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.95;">Tu acceso de prueba gratuita de 300 respuestas ha sido activado</p>
                    </td>
                  </tr>

                  <!-- CUERPO DE MENSAJE -->
                  <tr>
                    <td style="padding: 35px 30px; color: #334155; font-size: 15px; line-height: 1.6;">
                      <p style="margin-top: 0;">Hola,</p>
                      
                      <p>Gracias por registrarte para probar nuestra tecnología. Hemos generado una credencial de acceso para que experimentes la automatización de Copilot.ai directamente en tu navegador (compatible con Gmail y Whatsapp Web).</p>
                      
                      <p>A continuación, te proporcionamos tu clave de activación única:</p>

                      <!-- TARJETA DE LICENCIA -->
                      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin: 25px 0;">
                        <tr>
                          <td style="padding: 20px; text-align: center;">
                            <span style="font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">Tu Clave de Prueba Gratuita</span>
                            <div style="background-color: #ffffff; border: 2px dashed #10b981; border-radius: 6px; padding: 12px 20px; font-family: 'Courier New', Courier, monospace; font-size: 22px; font-weight: bold; color: #047857; letter-spacing: 3px; margin: 12px 0;">
                              ${licenseKey}
                            </div>
                            <div style="font-size: 13px; color: #64748b; margin-top: 5px;">
                              <span>⚡ <strong>Incluye:</strong> 300 Respuestas automatizadas</span> &nbsp;|&nbsp; 
                              <span>⏳ <strong>Vigencia:</strong> 30 días de uso</span>
                            </div>
                          </td>
                        </tr>
                      </table>

                      <!-- INSTRUCCIONES DE USO -->
                      <h3 style="color: #0f172a; font-size: 16px; margin-top: 25px; margin-bottom: 10px;">¿Cómo empezar?</h3>
                      <ol style="margin: 0; padding-left: 20px; color: #475569; font-size: 14px; line-height: 1.8;">
                        <li>Abre la extensión <strong>Copilot.ai</strong> en tu navegador Chrome.</li>
                        <li>Asegúrate de estar en tu panel de correo (Gmail o cliente compatible).</li>
                        <li>Ingresa la clave <strong>${licenseKey}</strong> en el campo de licencia y haz clic en <strong>Activar</strong>.</li>
                        <li>¡Guarda la configuración para que la extensión sincronice las respuestas en vivo!</li>
                      </ol>

                      <p style="margin-top: 25px; font-size: 14px; color: #64748b;">Una vez agotado tu cupo de respuestas de prueba, podrás actualizar a un plan Pro o B2B para mantener el servicio sin interrupciones.</p>
                    </td>
                  </tr>

                  <!-- FOOTER CORPORATIVO -->
                  <tr>
                    <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 25px 30px; text-align: center; color: #94a3b8; font-size: 12px; line-height: 1.5;">
                      <p style="margin: 0 0 10px 0; font-weight: 600; color: #64748b;">Copilot.ai Software & Technology</p>
                      <p style="margin: 0 0 10px 0;">
                        <a href="https://copilot.prestigecloser.com/" style="color: #10b981; text-decoration: none; margin: 0 8px;">Sitio Web</a> |
                        <a href="https://copilot.prestigecloser.com/soporte" style="color: #10b981; text-decoration: none; margin: 0 8px;">Centro de Ayuda</a> |
                        <a href="https://copilot.prestigecloser.com/privacidad" style="color: #10b981; text-decoration: none; margin: 0 8px;">Política de Privacidad</a>
                      </p>
                      <p style="margin: 0; font-size: 11px;">Mensaje automático enviado a ${email}. Conserve este correo para la activación de su acceso de prueba.</p>
                    </td>
                  </tr>

                </table>

              </td>
            </tr>
          </table>

        </body>
        </html>
    `;

    await enviarCorreoBrevo(email, licenseKey, 'Tu clave de prueba gratuita para Copilot.ai 🎁', htmlContenido);

    return res.status(200).json({ 
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
// ENDPOINT: Generador de System Prompt Personalizado (Meta-Prompt)
// ==========================================
app.post('/api/generar-system-prompt', async (req, res) => {
  try {
    const licenseKey = req.headers['x-user-license'];
    const { descripcionNegocio, objetivoBot } = req.body;

    // 1. Validar presencia de clave de licencia
    if (!licenseKey) {
      return res.status(401).json({ 
        ok: false, 
        error: 'No se proporcionó una clave de licencia en los encabezados.' 
      });
    }

    // 2. Buscar y verificar la licencia en la base de datos
    const licencia = await License.findOne({ licenseKey: licenseKey.trim() });
    
    // Si no existe o se requiere validación por defecto para entorno TRIAL_KEY sin DB
    if (!licencia && licenseKey !== 'TRIAL_KEY') {
      return res.status(401).json({ 
        ok: false, 
        error: 'La clave de licencia proporcionada es inválida o no existe.' 
      });
    }

    // 3. Verificación de vigencia y estado de la suscripción/prueba
    if (licencia) {
      const ahora = new Date();
      if (licencia.status === 'expired' || (licencia.expiresAt && licencia.expiresAt < ahora)) {
        return res.status(403).json({
          ok: false,
          code: 'SUBSCRIPTION_EXPIRED',
          error: 'Tu suscripción o periodo de prueba ha expirado. Renueva tu licencia para continuar.'
        });
      }

      if (licencia.status === 'inactive') {
        return res.status(403).json({
          ok: false,
          code: 'SUBSCRIPTION_INACTIVE',
          error: 'Tu licencia se encuentra inactiva o presenta un error de pago.'
        });
      }
    }

    // 4. Si la petición es exclusivamente para prueba o activación rápida desde la extensión
    if (objetivoBot === 'Test' || descripcionNegocio === 'Validación de licencia') {
      return res.status(200).json({
        ok: true,
        message: 'Licencia activa y verificada con éxito.'
      });
    }

    // 5. Validar datos mínimos obligatorios para sintetizar el prompt
    if (!descripcionNegocio) {
      return res.status(400).json({ 
        ok: false, 
        error: 'La descripción del negocio es requerida para generar el System Prompt.' 
      });
    }

    // 6. Construcción del Meta-Prompt adaptado a la Extensión (Gmail & WebMail Automation)
    const systemPromptMeta = `
      Escribe un experto Prompt Engineer especialista en arquitectura de IA para asistentes conversacionales y venta directa multicanal (Gmail, WebMail y Soporte).
      
      OBJETIVO:
      Crear una instrucción de sistema (System Prompt) estructurada, profesional y altamente efectiva para entrenar el asistente conversacional de este cliente.

      DATOS DEL CLIENTE:
      - Descripción del Negocio / Servicio / Precios / Reglas: "${descripcionNegocio}"
      - Objetivo Principal del Bot: "${objetivoBot || 'Atender clientes, resolver dudas con precisión y guiar expertamente hacia la conversión, venta o agendamiento.'}"

      INSTRUCCIONES DE SALIDA:
      Escribe un System Prompt claro, redactado en segunda persona ("Eres un..."). Debe definir:
      1. El rol, identidad y personalidad del asistente.
      2. Reglas de comunicación adaptadas a correos y mensajes directos (tono empático, profesional, concisión y estructura escaneable).
      3. Protocolos para responder preguntas frecuentes sobre servicios/precios y guiar al cliente al objetivo principal.
      
      REGLA CRÍTICA: Devuelve ÚNICAMENTE el texto del System Prompt listo para usar, sin introducciones, saludos ni comentarios adicionales.
    `;

    // 7. Llamada al modelo de IA
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: systemPromptMeta }],
      temperature: 0.7,
      max_tokens: 450
    });

    const promptGenerado = completion.choices[0].message.content.trim();

    // 8. Incrementar conteo de uso en la base de datos si aplica
    if (licencia) {
      licencia.usageCount = (licencia.usageCount || 0) + 1;
      await licencia.save();
    }

    return res.status(200).json({ 
      ok: true, 
      promptGenerado: promptGenerado 
    });

  } catch (error) {
    console.error('Error en /api/generar-system-prompt:', error.message);
    return res.status(500).json({ 
      ok: false, 
      error: 'Error al generar la instrucción personalizada de IA.' 
    });
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

// Endpoint para enviar la propuesta formal e invitación al Invitado de Honor del Programa de Feedback
app.post('/api/admin/enviar-propuesta-feedback', async (req, res) => {
    try {
        const { adminSecret, email, nombre } = req.body;

        if (adminSecret !== process.env.ADMIN_SECRET) {
            return res.status(401).json({ success: false, error: "No autorizado" });
        }

        if (!email) {
            return res.status(400).json({ success: false, error: "El correo es obligatorio" });
        }

        const nombreUsuario = nombre || "Invitado/a de Honor";
        const logoUrl = "https://copilot.prestigecloser.com/logo.png"; // O ajusta la URL real de tu logo

        // HTML completo y detallado adaptado exactamente al diseño visual estructurado que solicitaste
        const htmlFeedbackPropuesta = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; background-color: #f4f6f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; -webkit-font-smoothing: antialiased;">
          
          <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f4f6f9; padding: 30px 0;">
            <tr>
              <td align="center">
                
                <!-- Contenedor Principal -->
                <table border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
                  
                  <!-- HEADER / CABECERA CON LOGO -->
                  <tr>
                    <td align="center" style="background-color: #0f172a; padding: 25px 20px;">
                      <img src="${logoUrl}" alt="Copilot.ai" width="350" style="display: block; border: 0; max-width: 90%; height: auto;">
                    </td>
                  </tr>

                  <!-- BANNER INVITACIÓN VIP -->
                  <tr>
                    <td style="background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); padding: 25px 30px; text-align: center; color: #ffffff;">
                      <h1 style="margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">🌟 Invitación Exclusiva: Programa de Feedback</h1>
                      <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.95;">Acceso VIP sin costo como Invitado de Honor en Copilot.ai</p>
                    </td>
                  </tr>

                  <!-- CUERPO DE MENSAJE -->
                  <tr>
                    <td style="padding: 35px 30px; color: #334155; font-size: 15px; line-height: 1.6;">
                      <p style="margin-top: 0;">Hola <strong>${nombreUsuario}</strong>,</p>
                      
                      <p>Nos ponemos en contacto contigo para extenderte una invitación personal y exclusiva como <strong>Invitado de Honor</strong> en nuestro programa privado de feedback y validación anticipada de tecnología para <strong>Copilot.ai</strong>.</p>
                      
                      <p>Sabemos que la agilidad comercial es vital. Por ello, hemos desarrollado un ecosistema avanzado de extensiones inteligentes para eliminar la fricción operativa y multiplicar los cierres de ventas. Durante este programa, tendrás acceso total y sin costo a nuestras soluciones principales:</p>

                      <!-- DESCRIPCIÓN DE HERRAMIENTAS -->
                      <div style="background-color: #f8fafc; border-left: 4px solid #2563eb; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
                        <h3 style="margin: 0 0 8px 0; color: #1e3a8a; font-size: 15px;">🚀 1. WhatsApp Sales Copilot</h3>
                        <p style="margin: 0; font-size: 14px; color: #334155;">
                          Automatiza la lectura de chats complejos y notas de voz kilométricas[cite: 3]. Transcribe audios en tiempo real[cite: 3], redacta borradores de cierre con tonos persuasivos[cite: 3], inyecta respuestas con un solo clic[cite: 3] y permite dictado por IA[cite: 3].
                        </p>
                      </div>

                      <div style="background-color: #f8fafc; border-left: 4px solid #10b981; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
                        <h3 style="margin: 0 0 8px 0; color: #065f46; font-size: 15px;">💼 2. Gmail Sales Copilot</h3>
                        <p style="margin: 0; font-size: 14px; color: #334155;">
                          Simplifica la gestión de correos extensos resumiendo hilos al instante[cite: 4]. Redacta propuestas y respuestas comerciales con plantillas integradas[cite: 4] y cuenta con un sistema de dictado inteligente multicampo[cite: 4].
                        </p>
                      </div>

                      <!-- BENEFICIOS DE LA MEMBRESÍA -->
                      <h3 style="color: #0f172a; font-size: 16px; margin-top: 25px; margin-bottom: 10px;">🎁 Beneficios de tu Membresía VIP:</h3>
                      <ul style="margin: 0; padding-left: 20px; color: #475569; font-size: 14px; line-height: 1.8;">
                        <li><strong>Acceso Ilimitado:</strong> Disfruta sin restricciones de todas las funciones PRO durante el periodo de prueba.</li>
                        <li><strong>Influencia Directa:</strong> Tus sugerencias técnicas dirigirán las próximas actualizaciones globales del software.</li>
                        <li><strong>Soporte Prioritario:</strong> Canal directo con nuestro equipo de ingeniería y producto.</li>
                      </ul>

                      <!-- TARJETA DE ACCIÓN / RESPUESTA -->
                      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; margin: 25px 0;">
                        <tr>
                          <td style="padding: 20px; text-align: center;">
                            <span style="font-size: 13px; font-weight: 700; color: #1e40af; text-transform: uppercase; letter-spacing: 0.5px;">¿Aceptas ser nuestro Invitado de Honor?</span>
                            <div style="font-size: 14px; color: #334155; margin-top: 8px;">
                              Para activar de inmediato tus credenciales y accesos VIP, simplemente <strong>responde directamente a este correo</strong> escribiendo:
                            </div>
                            <div style="background-color: #ffffff; border: 2px dashed #2563eb; border-radius: 6px; padding: 10px 15px; font-family: 'Courier New', Courier, monospace; font-size: 18px; font-weight: bold; color: #1e40af; margin: 12px auto; display: inline-block;">
                              "SÍ" para confirmar &nbsp;|&nbsp; "NO" para declinar
                            </div>
                          </td>
                        </tr>
                      </table>

                      <p style="margin-top: 25px; font-size: 14px; color: #64748b;">Agradecemos de antemano tu valioso tiempo y liderazgo. Quedamos atentos a tu respuesta.</p>
                    </td>
                  </tr>

                  <!-- FOOTER CORPORATIVO -->
                  <tr>
                    <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 25px 30px; text-align: center; color: #94a3b8; font-size: 12px; line-height: 1.5;">
                      <p style="margin: 0 0 10px 0; font-weight: 600; color: #64748b;">Copilot.ai Software & Technology</p>
                      <p style="margin: 0 0 10px 0;">
                        <a href="https://copilot.prestigecloser.com/" style="color: #2563eb; text-decoration: none; margin: 0 8px;">Sitio Web</a> |
                        <a href="https://copilot.prestigecloser.com/soporte" style="color: #2563eb; text-decoration: none; margin: 0 8px;">Centro de Ayuda</a> |
                        <a href="https://copilot.prestigecloser.com/privacidad" style="color: #2563eb; text-decoration: none; margin: 0 8px;">Política de Privacidad</a>
                      </p>
                      <p style="margin: 0; font-size: 11px;">Mensaje institucional exclusivo enviado a ${email} a través de Copilot.ai.</p>
                    </td>
                  </tr>

                </table>

              </td>
            </tr>
          </table>

        </body>
        </html>
        `;

        const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST",
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "api-key": process.env.BREVO_API_KEY
            },
            body: JSON.stringify({
                sender: {
                    name: "Copilot.ai Team",
                    email: "copilot.ia@prestigecloser.com"
                },
                replyTo: {
                    email: "copilot.ia.pro@gmail.com",
                    name: "Copilot.ai Feedback VIP"
                },
                to: [{ email: email, name: nombreUsuario }],
                subject: "Invitación VIP: Invitado de Honor Programa de Feedback Copilot.ai",
                htmlContent: htmlFeedbackPropuesta
            })
        });

        const brevoData = await brevoResponse.json();

        if (!brevoResponse.ok) {
            throw new Error(brevoData.message || "Error al enviar el correo mediante la API de Brevo");
        }

        return res.status(200).json({ 
            success: true, 
            message: "Propuesta formal enviada con éxito." 
        });

    } catch (error) {
        console.error("Error al enviar propuesta:", error);
        return res.status(500).json({ success: false, error: error.message });
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
// ENDPOINT 2: Generar Respuesta Universal (Adaptable a Instrucciones del Usuario)
// ==========================================
app.post('/api/generar-respuesta', validarLicencia, async (req, res) => {
  try {
    const { 
      mensajeCliente, 
      instruccionAdicional,
      destinatario,
      historialChat, 
      contextoNegocio, 
      promptEntrenamientoUsuario, 
      modoOperacion, 
      tipoAccion, 
      tono 
    } = req.body;

    // 🔎 LOGS DE DEPURACIÓN
    console.log('\n================ DEPURACIÓN DE MEMORIA / HISTORIAL ================');
    console.log('📥 Mensaje actual del cliente / instrucción:', mensajeCliente);
    console.log('📌 Modo de Operación:', modoOperacion);
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
          error: 'Has consumido todos tus mensajes de prueba gratuita. Activa el Plan Starter o Pro para seguir automatizando tus respuestas sin límites.'
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

    // ==========================================
    // CASO 1: Análisis de Lectura / Explicación
    // ==========================================
    if (tipoAccion === 'analizar_explicar') {
      let conversacionContexto = '';
      if (historialChat && Array.isArray(historialChat) && historialChat.length > 0) {
        conversacionContexto = `\nHISTORIAL RECIENTE DEL CHAT:\n` + historialChat.map(m => `- ${(m.remitente || m.role || 'USUARIO').toUpperCase()}: ${m.texto || m.content}`).join('\n');
      }

      const promptExplicacion = `
        Analiza el siguiente mensaje entrante y el contexto de la conversación.
        
        OBJETIVO:
        Explica en MÁXIMO 2 oraciones breves, claras y directas cuál es el tema principal, la intención o el contenido central del mensaje.

        ${conversacionContexto}
        Mensaje o correo analizado: "${mensajeCliente}"
      `;

      const completionAnalisis = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: promptExplicacion }],
        temperature: 0.2,
        max_tokens: 150
      });

      return res.json({ respuesta: completionAnalisis.choices[0].message.content.trim() });
    }

    // ==========================================
    // CASO 2: Redacción de Correo Desde Cero
    // ==========================================
    if (modoOperacion === 'redaccion_desde_cero') {
      const promptRedaccion = `
OBJETIVO:
Redacta un correo desde cero basándote estrictamente en las instrucciones enviadas y en las directivas del usuario.

DESTINATARIO: ${destinatario || 'Destinatario'}
OBJETIVO E INSTRUCCIONES: "${mensajeCliente}"

INSTRUCCIONES DEL USUARIO Y CONTEXTO:
${promptEntrenamientoUsuario || contextoNegocio || 'Responde de manera natural según las instrucciones.'}

REGLAS DE HUMANIZACIÓN (OBLIGATORIO):
1. Redacta como una persona real, de forma natural, fluida y profesional.
2. PROHIBIDO usar frases clisé o robóticas de IA ("Espero que este correo te encuentre bien", "Quedo atento a tus comentarios", "Estoy aquí para ayudarte").
3. NUNCA uses viñetas ni pasos numerados (1, 2, 3) a menos que la instrucción lo pida expresamente.

FORMATO DE SALIDA REQUERIDO (JSON ESTRICTO):
Responde ÚNICAMENTE con un objeto JSON válido con este formato:
{
  "asunto": "Asunto claro aquí",
  "respuesta": "Cuerpo completo del correo redactado aquí"
}
      `.trim();

      const completionRedaccion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: promptRedaccion }],
        response_format: { type: "json_object" },
        temperature: 0.5,
        max_tokens: 450
      });

      const jsonOutput = JSON.parse(completionRedaccion.choices[0].message.content.trim());

      // Incrementar contador de tokens
      if (req.userLicenseDoc) {
        req.userLicenseDoc.tokensUsados = (req.userLicenseDoc.tokensUsados || 0) + 1;
        req.userLicenseDoc.usageCount = req.userLicenseDoc.tokensUsados;
        await req.userLicenseDoc.save();
      }

      return res.json({
        asunto: jsonOutput.asunto || 'Sin asunto',
        respuesta: jsonOutput.respuesta || ''
      });
    }

    // ==========================================
    // CASO 3: Generación Estándar (Controlada por Prompt de Extensión)
    // ==========================================

    // 1. CONFIGURAR INSTRUCCIONES DE TONO (OPCIONALES SI EL USUARIO ENVÍA TONO)
    let instruccionTono = '';
    if (tono === 'empatico') instruccionTono = 'Usa un tono cálido, amigable y cercano.';
    else if (tono === 'urgencia') instruccionTono = 'Mantén un tono ágil, directo y de pronta acción.';
    else if (tono === 'persuasivo') instruccionTono = 'Usa un tono persuasivo y seguro.';
    else if (tono === 'breve') instruccionTono = 'Sé muy breve y conciso (1 a 3 oraciones).';
    else if (tono === 'directo') instruccionTono = 'Sé directo, natural y al punto.';

    // 2. CONSTRUCCIÓN DEL SYSTEM PROMPT STRICTAMENTE HUMANO SIN REGLAS COMERCIALES
    const directivasPersonalizadas = promptEntrenamientoUsuario || contextoNegocio || 'Responde directamente al mensaje atendiendo la consulta de forma natural.';

    const systemPrompt = `
REGLA PRINCIPAL:
Escribe 100% como un ser humano real comunicándose por chat o correo. Adapta toda la lógica, comportamiento y contenido estricto a las INSTRUCCIONES DEL USUARIO.

REGLAS OBLIGATORIAS DE HUMANIZACIÓN (PROHIBIDO ACTUAR COMO ROBOT/IA):
- PROHIBIDO usar listas numeradas (1., 2., 3.) o viñetas salvo que el usuario lo pida expresamente.
- PROHIBIDO usar frases cliché de asistente virtual ("¡Hola! ¿En qué puedo ayudarte hoy?", "Espero que te encuentres bien", "Quedo a tu entera disposición", "No dudes en contactarme").
- NUNCA fuerces cierres comerciales, agendas de citas, demos, ni enlaces a menos que las INSTRUCCIONES DEL USUARIO lo indiquen explícitamente.
- Redacta en párrafos cortos, fluidos y de estilo conversacional directo.
- Si no hay instrucciones específicas de negocio, limítate a responder lo que la persona pregunta de forma lógica y natural.

INSTRUCCIONES DEL USUARIO (ENVIADAS DESDE LA EXTENSIÓN):
${directivasPersonalizadas}

${instruccionTono ? `TONO DE COMUNICACIÓN: ${instruccionTono}` : ''}
    `.trim();

    // 3. CONSTRUIR MENSAJES PARA OPENAI
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
        let contenidoMensaje = mensajeCliente;
        if (instruccionAdicional && instruccionAdicional.trim().length > 0) {
          contenidoMensaje += `\n\n[INSTRUCCIÓN ADICIONAL: ${instruccionAdicional.trim()}]`;
        }
        mensajesChatOpenAI.push({ role: 'user', content: contenidoMensaje });
      }
    } else {
      let contenidoMensaje = mensajeCliente;
      if (instruccionAdicional && instruccionAdicional.trim().length > 0) {
        contenidoMensaje += `\n\n[INSTRUCCIÓN ADICIONAL: ${instruccionAdicional.trim()}]`;
      }
      mensajesChatOpenAI.push({ role: 'user', content: contenidoMensaje });
    }

    // 🔎 LOG FINAL
    console.log('🤖 Payload final enviado a OpenAI:', JSON.stringify(mensajesChatOpenAI, null, 2));

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: mensajesChatOpenAI,
      temperature: 0.5, 
      max_tokens: 350
    });

    const respuestaIA = completion.choices[0].message.content.trim();

    // 🎯 INCREMENTO DE CONTADOR DE TOKENS EN LA LICENCIA
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



// ==========================================
// ENDPOINT NUEVO: Resumir Correo Electrónico
// ==========================================
app.post('/api/resumir-correo', validarLicencia, async (req, res) => {
  try {
    const { contenidoCorreo, remitente, asunto } = req.body;

    if (!contenidoCorreo) {
      return res.status(400).json({ error: 'El parámetro "contenidoCorreo" es obligatorio.' });
    }

    // 🛡️ VALIDACIÓN DE LÍMITE DE TOKENS (MISMA LÓGICA DE SEGURIDAD)
    if (req.userLicenseDoc) {
      const tipoLicencia = (req.userLicenseDoc.tipo || req.userLicenseDoc.status || 'trial').toLowerCase();
      const tokensUsados = req.userLicenseDoc.tokensUsados !== undefined ? req.userLicenseDoc.tokensUsados : (req.userLicenseDoc.usageCount || 0);
      const limiteTokens = req.userLicenseDoc.limiteTokens !== undefined ? req.userLicenseDoc.limiteTokens : 20;

      if (tokensUsados >= limiteTokens || tipoLicencia === 'expired' || tipoLicencia === 'inactive' || req.userLicenseDoc.suspended) {
        return res.status(403).json({
          code: 'TOKENS_EXPIRED',
          error: 'Has alcanzado el límite de tus mensajes disponibles o tu suscripción se encuentra inactiva.'
        });
      }
    }

    const systemPromptResumen = `
Actúa como un asistente ejecutivo ultrarrápido. Lee el siguiente correo electrónico y redacta un resumen directo, ejecutivo y al grano de máximo 3 o 4 líneas que explique exactamente qué quiere el cliente, cuál es el problema o de qué trata, sin rodeos.
    `.trim();

    const promptUsuario = `
ASUNTO: ${asunto || 'Sin asunto'}
REMITENTE: ${remitente || 'Desconocido'}

CONTENIDO DEL CORREO:
${contenidoCorreo}
    `.trim();

    const completionResumen = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPromptResumen },
        { role: 'user', content: promptUsuario }
      ],
      temperature: 0.2,
      max_tokens: 150
    });

    const resumenTexto = completionResumen.choices[0].message.content.trim();

    // 🎯 INCREMENTO DE CONTADOR DE TOKENS EN LA LICENCIA (MONGODB)
    if (req.userLicenseDoc) {
      const currentTokens = req.userLicenseDoc.tokensUsados !== undefined ? req.userLicenseDoc.tokensUsados : (req.userLicenseDoc.usageCount || 0);
      req.userLicenseDoc.tokensUsados = currentTokens + 1;
      req.userLicenseDoc.usageCount = req.userLicenseDoc.tokensUsados;
      await req.userLicenseDoc.save();
    }

    return res.json({ resumen: resumenTexto });

  } catch (error) {
    console.error('Error en /api/resumir-correo:', error.message);
    return res.status(500).json({ error: 'Ocurrió un error al generar el resumen del correo.' });
  }
});

// ==========================================
// ENDPOINT PARA OBTENER TODA LA INFORMACIÓN DE UNA LICENCIA/USUARIO
// ==========================================
app.post('/api/admin/detalles-licencia', async (req, res) => {
    try {
        const { adminSecret, email, licenseKey } = req.body;

        // Validar credenciales de administrador con fallback
        if (adminSecret !== (process.env.ADMIN_SECRET || 'mi_clave_secreta_super_segura_2026')) {
            return res.status(401).json({ success: false, error: 'No autorizado.' });
        }

        // Sanitización previa para evitar errores de tipo (TypeError en trim())
        const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : null;
        const cleanKey = typeof licenseKey === 'string' ? licenseKey.trim() : null;

        if (!cleanEmail && !cleanKey) {
            return res.status(400).json({ success: false, error: 'Debes proporcionar un correo o una clave de licencia.' });
        }

        const query = cleanEmail ? { email: cleanEmail } : { licenseKey: cleanKey };
        
        // Uso de .lean() para mejorar el rendimiento y simplificar el objeto JS plano
        const licencia = await License.findOne(query).lean();

        if (!licencia) {
            return res.status(404).json({ success: false, error: 'No se encontró ninguna licencia con los datos proporcionados.' });
        }

        return res.json({
            success: true,
            detalles: {
                email: licencia.email || 'N/A',
                licenseKey: licencia.licenseKey || 'N/A',
                status: licencia.status || 'N/A',
                plan: licencia.plan || 'N/A',
                fechaInicio: licencia.createdAt || licencia.fechaInicio || 'N/A',
                fechaFin: licencia.expiresAt || licencia.fechaFin || 'N/A',
                activacionesActuales: licencia.activationsCount || 0,
                maxActivations: licencia.maxActivations || 0,
                cobrosRealizados: licencia.paymentCount || licencia.cobrosLlevados || 0,
                estaActivo: licencia.isActive ?? true,
                enPausa: licencia.isPaused || false,
                cancelado: licencia.isCancelled || licencia.status === 'cancelled' || false,
                preapprovalId: licencia.preapprovalId || 'N/A',
                rawdata: licencia
            }
        });

    } catch (error) {
        console.error('Error al obtener detalles de la licencia:', error);
        return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

// ==========================================
// ENDPOINT PARA ELIMINAR CUENTA/LICENCIA FREE POR CORREO
// ==========================================
app.post('/api/admin/eliminar-cuenta-free', async (req, res) => {
    try {
        const { adminSecret, email } = req.body;

        if (adminSecret !== process.env.ADMIN_SECRET) {
            return res.status(401).json({ success: false, error: 'No autorizado.' });
        }

        if (!email) {
            return res.status(400).json({ success: false, error: 'El correo electrónico es obligatorio.' });
        }

        // Buscar y eliminar la licencia que coincida con el correo y esté en estado 'trial' o plan 'Prueba Gratuita'
        const resultado = await License.deleteOne({
            email: email.trim().toLowerCase(),
            $or: [
                { status: 'trial' },
                { plan: 'Prueba Gratuita' }
            ]
        });

        if (resultado.deletedCount === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'No se encontró ninguna cuenta free asociada a ese correo.' 
            });
        }

        return res.json({
            success: true,
            message: `La cuenta free asociada a ${email} ha sido eliminada correctamente.`
        });

    } catch (error) {
        console.error('Error al eliminar cuenta free por correo:', error);
        return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

// ==========================================
// 1. ENDPOINT PARA PROGRAMAR LA CANCELACIÓN
// ==========================================
app.post('/api/admin/programar-cancelacion', async (req, res) => {
    try {
        const { adminSecret, emailContacto, preapprovalId, fechaCancelacion } = req.body;

        if (adminSecret !== (process.env.ADMIN_SECRET || 'mi_clave_secreta_super_segura_2026')) {
            return res.status(401).json({ success: false, error: 'No autorizado.' });
        }

        if (!fechaCancelacion || (!emailContacto && !preapprovalId)) {
            return res.status(400).json({ success: false, error: 'Faltan datos obligatorios (fecha y identificador).' });
        }

        // Buscar por preapprovalId o por correo electrónico en el esquema License
        const query = preapprovalId ? { preapprovalId } : { email: emailContacto };
        
        const subActualizada = await License.findOneAndUpdate(
            query,
            { 
                cancelAt: new Date(fechaCancelacion), 
                estadoCancelacionProgramada: 'PENDIENTE'
            },
            { new: true }
        );

        if (!subActualizada) {
            return res.status(404).json({ success: false, error: 'No se encontró una suscripción activa con esos datos.' });
        }

        return res.json({
            success: true,
            message: `Cancelación programada con éxito para el día ${fechaCancelacion}.`,
            data: subActualizada
        });

    } catch (error) {
        console.error('Error al programar cancelación:', error);
        return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

// ==========================================
// 2. ENDPOINT PARA VER LA LISTA DE PLANES PENDIENTES DE CANCELAR
// ==========================================
app.post('/api/admin/listar-pendientes', async (req, res) => {
    try {
        const { adminSecret } = req.body;
        if (adminSecret !== (process.env.ADMIN_SECRET || 'mi_clave_secreta_super_segura_2026')) {
            return res.status(401).json({ success: false, error: 'No autorizado.' });
        }

        // Buscar todas las licencias con cancelación programada pendiente
        const pendientes = await License.find({ estadoCancelacionProgramada: 'PENDIENTE' });

        return res.json({ success: true, pending: pendientes });
    } catch (error) {
        return res.status(500).json({ success: false, error: 'Error al obtener lista.' });
    }
});

// ==========================================
// 3. CRON JOB: SE EJECUTA TODOS LOS DÍAS A MEDIANOCHE (00:00)
// ==========================================
cron.schedule('0 0 * * *', async () => {
    console.log('[CRON] Verificando suscripciones programadas para cancelar hoy...');
    try {
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);

        // Buscar licencias cuya fecha límite sea hoy o anterior y sigan pendientes
        const porCancelar = await License.find({
            estadoCancelacionProgramada: 'PENDIENTE',
            cancelAt: { $lte: hoy }
        });

        for (const sub of porCancelar) {
            try {
                if (sub.preapprovalId) {
                    // Cancelar en la API de Mercado Pago automáticamente usando axios
                    await axios.put(
                        `https://api.mercadopago.com/preapproval/${sub.preapprovalId}`,
                        { status: 'cancelled' },
                        {
                            headers: {
                                'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
                                'Content-Type': 'application/json'
                            }
                        }
                    );
                }

                sub.estadoCancelacionProgramada = 'EJECUTADA';
                sub.status = 'expired';
                await sub.save();
                console.log(`[CRON] Suscripción/Licencia ${sub.email || sub.preapprovalId} cancelada exitosamente por fecha límite.`);
            } catch (mpError) {
                console.error(`[CRON ERROR] No se pudo cancelar en MP la suscripción ${sub.preapprovalId}:`, mpError.response?.data || mpError.message);
            }
        }
    } catch (err) {
        console.error('[CRON ERROR] Error en la ejecución diaria de cancelaciones:', err);
    }
});

// ==========================================
// ENDPOINT: Cotización Empresarial B2B (Sin Correos, Guardado en Base de Datos)
// ==========================================
app.post('/api/cotizacion-empresarial', async (req, res) => {
    try {
        const { empresa, contacto, email, telefono, licencias, pais, mensaje } = req.body;

        // Validación básica
        if (!empresa || !contacto || !email || !telefono) {
            return res.status(400).json({ success: false, error: "Faltan campos obligatorios." });
        }

        // Guardar directamente en la base de datos de MongoDB
        await LeadEmpresa.create({
            empresa, 
            contacto, 
            email, 
            telefono, 
            licencias, 
            pais, 
            mensaje, 
            fecha: new Date(),
            estado: 'PENDIENTE'
        });

        console.log(`Nueva cotización B2B guardada en la plataforma para: ${empresa} (${email})`);

        return res.status(200).json({
            success: true,
            message: "Solicitud registrada en nuestra plataforma correctamente."
        });

    } catch (error) {
        console.error("Error al procesar cotización empresarial:", error);
        return res.status(500).json({ success: false, error: "Error interno al procesar la solicitud." });
    }
});

// Agrega este endpoint en tu archivo principal del servidor Express (ej. server.js o index.js)

app.get('/api/admin/metricas', async (req, res) => {
    try {
        // Supongamos que obtienes los suscriptores desde tu base de datos (MongoDB/PostgreSQL)
        const suscriptores = await Suscriptor.find(); // O tu método de consulta

        let ventasHistoricasTotales = 0;
        let mrrActual = 0;
        let activosCount = 0;
        let pausadosCount = 0;
        let canceladosCount = 0;
        let dejadoDeGanarMRR = 0;

        suscriptores.forEach(sub => {
            const monto = sub.monto || 0;
            
            if (sub.estado === 'Activo') {
                mrrActual += monto;
                activosCount++;
                ventasHistoricasTotales += monto * 4; // Estimado histórico acumulado
            } else if (sub.estado === 'Pausado') {
                pausadosCount++;
                dejadoDeGanarMRR += monto; // Dinero dejado de percibir por pausa
            } else if (sub.estado === 'Cancelado') {
                canceladosCount++;
                dejadoDeGanarMRR += monto; // Dinero dejado de percibir por cancelación definitiva
            }
        });

        // Proyección mes siguiente: MRR actual más un factor de crecimiento estimado (ej. 10% conservador)
        const proyeccionMesSiguiente = mrrActual * 1.10;

        const tasaChurn = suscriptores.length > 0 
            ? ((canceladosCount / suscriptores.length) * 100).toFixed(1) 
            : 0;

        res.json({
            success: true,
            metrics: {
                ventasHistoricasTotales,
                mrrActual,
                activosCount,
                pausadosCount,
                canceladosCount,
                dejadoDeGanarMRR, // <--- Lo que se ha dejado de ganar por planes pausados/cancelados
                proyeccionMesSiguiente, // <--- Proyección estimada para el mes siguiente
                tasaChurn: `${tasaChurn}%`
            }
        });

    } catch (error) {
        console.error("Error al calcular métricas:", error);
        res.status(500).json({ success: false, message: "Error interno del servidor al procesar métricas." });
    }
});

app.get('/api/admin/suscriptores', async (req, res) => {
    try {
        const db = mongoose.connection.db;
        
        // 1. Obtiene todas las colecciones que existen en la base de datos actual
        const collections = await db.listCollections().toArray();
        let suscriptores = [];

        // 2. Busca de forma inteligente en qué colección hay documentos guardados
        for (let colInfo of collections) {
            const colName = colInfo.name;
            // Ignoramos colecciones internas del sistema si las hubiera
            if (colName.startsWith('system.')) continue;

            const docs = await db.collection(colName).find({}).toArray();
            
            // Si encontramos una colección que tenga documentos, los adaptamos al formato del CRM
            if (docs && docs.length > 0) {
                suscriptores = docs.map(item => ({
                    fecha: item.createdAt || item.fecha || item.date || new Date(),
                    nombre: item.nombre || item.user || item.client || item.username || 'Cliente General',
                    email: item.email || item.correo || item.mail || 'Sin Correo',
                    plan: item.plan || item.tipo || item.licenseType || 'Plan Estándar',
                    monto: Number(item.monto !== undefined ? item.monto : (item.price || item.amount || 0)),
                    estado: item.estado || item.status || 'Activo'
                }));
                break; // Usamos la primera colección con datos que encuentre
            }
        }

        const mrr = suscriptores.filter(s => s.estado === 'Activo').reduce((acc, curr) => acc + (curr.monto || 0), 0);
        const dejadoDeGanar = suscriptores
            .filter(s => s.estado === 'Pausado' || s.estado === 'Cancelado')
            .reduce((acc, curr) => acc + (curr.monto || 0), 0);
        
        const proyeccionSiguiente = mrr * 1.10;

        res.json({
            success: true,
            resumenFinanciero: {
                mrr,
                dejadoDeGanar,
                proyeccionSiguiente
            },
            suscriptores
        });

    } catch (error) {
        console.error("Error detallado:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// ENDPOINT: Obtener las Solicitudes para el Panel Admin
// ==========================================
app.get('/api/admin/cotizaciones', async (req, res) => {
    try {
        const leads = await LeadEmpresa.find().sort({ fecha: -1 }); // Ordena de más reciente a más antiguo
        return res.status(200).json({ success: true, leads });
    } catch (error) {
        console.error("Error al obtener las cotizaciones:", error);
        return res.status(500).json({ success: false, error: "Error al cargar los datos." });
    }
});
// ==========================================
// ENDPOINT PARA LISTAR CUENTAS/LICENCIAS FREE
// ==========================================
app.post('/api/admin/listar-cuentas-free', async (req, res) => {
    try {
        const { adminSecret } = req.body;

        if (adminSecret !== process.env.ADMIN_SECRET) {
            return res.status(401).json({ success: false, error: 'No autorizado.' });
        }

        // Buscar todas las licencias que estén en estado 'trial' o cuya plan sea 'Prueba Gratuita'
        const cuentas = await License.find({
            $or: [
                { status: 'trial' },
                { plan: 'Prueba Gratuita' }
            ]
        }).select('email status plan createdAt');

        return res.json({
            success: true,
            cuentas: cuentas
        });

    } catch (error) {
        console.error('Error al listar cuentas free:', error);
        return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

// ==========================================
// ENDPOINT: Listar Todas las Licencias del Sistema (Panel Admin)
// ==========================================
app.post('/api/admin/listar-todas-licencias', async (req, res) => {
    try {
        const { adminSecret } = req.body;

        // Validar contraseña de administrador del backend
        if (adminSecret !== (process.env.ADMIN_SECRET || 'mi_clave_secreta_super_segura_2026')) {
            return res.status(401).json({ success: false, error: "No autorizado. Admin Secret incorrecto." });
        }

        // Consultar la colección usando el modelo correcto 'License'
        const licencias = await License.find({}).lean();

        // Mapear los campos alineados con la estructura de la base de datos MongoDB
        const licenciasFormateadas = licencias.map(lic => ({
            email: lic.email || lic.correo || "N/A",
            licenseKey: lic.licenseKey || lic.key || "N/A",
            status: lic.status || lic.estado || "N/A",
            plan: lic.plan || lic.tipo || "N/A",
            fechaFin: lic.expiresAt || lic.fechaFin || lic.fechaVencimiento || "N/A",
            fechaInicio: lic.createdAt || lic.fechaInicio || "N/A",
            tokensUsados: lic.tokensUsados !== undefined ? lic.tokensUsados : (lic.usageCount || 0),
            limiteTokens: lic.limiteTokens || 0,
            preapprovalId: lic.preapprovalId || "N/A"
        }));

        return res.status(200).json({
            success: true,
            total: licenciasFormateadas.length,
            licencias: licenciasFormateadas
        });

    } catch (error) {
        console.error("Error al listar todas las licencias:", error);
        return res.status(500).json({ success: false, error: "Error interno del servidor." });
    }
});

// Ruta para cancelar una suscripción (Preapproval) en Mercado Pago
app.post('/api/admin/cancelar-suscripcion', async (req, res) => {
    try {
        const { adminSecret, preapprovalId } = req.body;

        // 1. Validar el secreto de administrador
        if (adminSecret !== process.env.ADMIN_SECRET) {
            return res.status(401).json({ success: false, error: 'No autorizado.' });
        }

        if (!preapprovalId) {
            return res.status(400).json({ success: false, error: 'Falta el preapprovalId de la suscripción.' });
        }

        // 2. Realizar petición PUT a la API de Mercado Pago para cancelar
        const response = await axios.put(
            `https://api.mercadopago.com/preapproval/${preapprovalId}`,
            { status: 'cancelled' },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`, // Tu token de acceso de Mercado Pago
                    'Content-Type': 'application/json'
                }
            }
        );

        return res.json({
            success: true,
            message: 'Suscripción cancelada correctamente en Mercado Pago.',
            data: response.data
        });

    } catch (error) {
        console.error('Error al cancelar la suscripción en Mercado Pago:', error.response?.data || error.message);
        return res.status(500).json({
            success: false,
            error: error.response?.data?.message || 'Error al comunicarse con la API de Mercado Pago.'
        });
    }
});

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
    const { nombreBeneficiario, email, durationDays, maxActivations, adminSecret } = req.body;

    // Validar contraseña de administrador
    if (adminSecret !== (process.env.ADMIN_SECRET || 'mi_clave_secreta_super_segura_2026')) {
      console.warn('❌ [BACKEND] Intento de acceso no autorizado con secret:', adminSecret);
      return res.status(403).json({ success: false, error: 'No autorizado. Admin secret incorrecto.' });
    }

    if (!nombreBeneficiario || !email || !durationDays || !maxActivations) {
      console.warn('❌ [BACKEND] Faltan parámetros en la petición.');
      return res.status(400).json({ success: false, error: 'Faltan parámetros (nombreBeneficiario, email, durationDays, maxActivations).' });
    }

    const licenseKey = generateLicenseKey('FB');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + Number(durationDays));

    const nuevaLicencia = new License({
      licenseKey,
      nombreBeneficiario,
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
    console.log(`✅ [BACKEND] Licencia creada y guardada en MongoDB: ${licenseKey} para ${nombreBeneficiario} (${email})`);

    // Enviar correo automático comercial con Brevo
    try {
      const logoUrl = process.env.LOGO_URL || 'https://lh3.googleusercontent.com/d/1GtxY0-91lcxLod1uEqtQCpVJSdWInUgk'; 

      const htmlContenido = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; background-color: #f4f6f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; -webkit-font-smoothing: antialiased;">
          
          <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f4f6f9; padding: 30px 0;">
            <tr>
              <td align="center">
                
                <!-- Contenedor Principal -->
                <table border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
                  
                  <!-- HEADER / CABECERA CON LOGO (Ancho ajustado a 350px para mantener proporción adecuada) -->
                  <tr>
                    <td align="center" style="background-color: #0f172a; padding: 25px 20px;">
                      <img src="${logoUrl}" alt="Copilot.ai" width="350" style="display: block; border: 0; max-width: 90%; height: auto;">
                    </td>
                  </tr>

                  <!-- BANNER COMERCIAL -->
                  <tr>
                    <td style="background: linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%); padding: 25px 30px; text-align: center; color: #ffffff;">
                      <h1 style="margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">Acceso Exclusivo al Programa Feedback 🚀</h1>
                      <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.9;">Forma parte de la experiencia de validación estratégica de Copilot.ai</p>
                    </td>
                  </tr>

                  <!-- CUERPO DE MENSAJE -->
                  <tr>
                    <td style="padding: 35px 30px; color: #334155; font-size: 15px; line-height: 1.6;">
                      <p style="margin-top: 0;">Estimado/a <strong>${nombreBeneficiario}</strong>,</p>
                      
                      <p>Nos complace darte la bienvenida a nuestro grupo de testers y aliados estratégicos. Has sido seleccionado/a para acceder a una versión VIP de nuestra plataforma para probar las últimas funciones automatizadas.</p>
                      
                      <p>A continuación, te proporcionamos tu credencial de acceso para activar tu extensión:</p>

                      <!-- TARJETA DE LICENCIA -->
                      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin: 25px 0;">
                        <tr>
                          <td style="padding: 20px; text-align: center;">
                            <span style="font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">Tu Clave de Licencia Exclusiva</span>
                            <div style="background-color: #ffffff; border: 2px dashed #6366f1; border-radius: 6px; padding: 12px 20px; font-family: 'Courier New', Courier, monospace; font-size: 22px; font-weight: bold; color: #4338ca; letter-spacing: 3px; margin: 12px 0;">
                              ${licenseKey}
                            </div>
                            <div style="font-size: 13px; color: #64748b; margin-top: 5px;">
                              <span>⏳ <strong>Duración:</strong> ${durationDays} días</span> &nbsp;|&nbsp; 
                              <span>👥 <strong>Cuentas permitidas:</strong> ${maxActivations}</span>
                            </div>
                          </td>
                        </tr>
                      </table>

                      <!-- INSTRUCCIONES DE USO -->
                      <h3 style="color: #0f172a; font-size: 16px; margin-top: 25px; margin-bottom: 10px;">¿Cómo activar tu clave?</h3>
                      <ol style="margin: 0; padding-left: 20px; color: #475569; font-size: 14px; line-height: 1.8;">
                        <li>Abre tu extensión en Google Chrome / Navegador.</li>
                        <li>Ingresa a la sección de <strong>Configuración / Licencia</strong>.</li>
                        <li>Pega la clave asignada arriba y haz clic en <strong>Activar Licencia</strong>.</li>
                      </ol>

                      <p style="margin-top: 25px; font-size: 14px; color: #64748b;">Tu retroalimentación es fundamental para optimizar nuestros algoritmos. Si detectas cualquier oportunidad de mejora, puedes escribirnos directamente respondiendo a este correo.</p>
                    </td>
                  </tr>

                  <!-- FOOTER CORPORATIVO -->
                  <tr>
                    <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 25px 30px; text-align: center; color: #94a3b8; font-size: 12px; line-height: 1.5;">
                      <p style="margin: 0 0 10px 0; font-weight: 600; color: #64748b;">Copilot.ai Software & Technology</p>
                      <p style="margin: 0 0 10px 0;">
                        <a href="https://copilot.prestigecloser.com/" style="color: #4f46e5; text-decoration: none; margin: 0 8px;">Sitio Web</a> |
                        <a href="https://t.me/copilotIA_notificacion_bot?start=VIP" style="color: #4f46e5; text-decoration: none; margin: 0 8px;">Soporte Técnico</a> |
                        <a href="https://tudominio.com/privacidad" style="color: #4f46e5; text-decoration: none; margin: 0 8px;">Política de Privacidad</a>
                      </p>
                      <p style="margin: 0; font-size: 11px;">Este es un mensaje automático enviado a ${email}. Por favor, conserva este correo para futuras referencias de tu licencia.</p>
                    </td>
                  </tr>

                </table>

              </td>
            </tr>
          </table>

        </body>
        </html>
      `;

      await enviarCorreoBrevo(email, licenseKey, 'Bienvenido al Programa Exclusivo de Feedback - Copilot.ai 🎁', htmlContenido);
    } catch (mailErr) {
      console.warn('⚠️ [BACKEND] La licencia se creó pero falló el envío de correo:', mailErr.message);
    }

    return res.json({ 
      success: true, 
      message: 'Licencia de feedback creada con éxito.', 
      licenseKey,
      details: { nombreBeneficiario, durationDays, maxActivations, expiresAt }
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
    let precioUSD = 1; // Plan Starter por defecto ($10 USD / mes)[cite: 4]
    let frecuencia = 1;
    let frecuenciaTipo = 'months';
    let limiteRespuestasDia = 200;
    let incluyeAudio = false;

    if (plan === 'pro') {
      precioUSD = 1; // Plan Pro / Completo ($59 USD / mes)[cite: 4]
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
        const status = subscriptionInfo.status; // 'authorized', 'pending', 'paused', 'cancelled', etc.
        
        // Correo del administrador/dueño de la empresa
        const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'tu_correo_admin@ejemplo.com';

        // 1. FLEXIBILIDAD DE ESTADO: Procesamos si está autorizado, pendiente inicial o si llega un pago exitoso
        if (status === 'authorized' || status === 'pending' || event.type === 'payment') {
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
            // 🛡️ PROTECCIÓN DUPLICADOS: Verificar si ya existe una licencia registrada con este preapprovalId
            let licenciaExistente = await License.findOne({ preapprovalId: preapprovalId });

            if (licenciaExistente) {
              console.log(`⚠️ [WEBHOOK B2B] La suscripción ${preapprovalId} ya había sido procesada previamente. Ignorando duplicado.`);
            } else {
              // 🏢 CASO B2B: Generar Licencia Matriz con Múltiples Activaciones
              const newLicenseKey = generateLicenseKey('B2B');
              const nuevaLicenciaCorporativa = new License({
                licenseKey: newLicenseKey,
                status: 'active',
                plan: `Empresarial B2B - ${datosB2B.empresaNombre} (${datosB2B.cantidadLicencias} Cuentas)`,
                usageCount: 0,
                tokensUsados: 0,
                limiteTokens: 999999,
                maxActivations: Number(datosB2B.cantidadLicencias),
                currentActivations: 0,
                email: payerEmail || 'suscriptor_b2b@local',
                expiresAt,
                preapprovalId: preapprovalId // Guardamos el ID para bloquear duplicados futuros
              });

              await nuevaLicenciaCorporativa.save();
              console.log(`✅ [WEBHOOK B2B] Licencia corporativa creada para ${datosB2B.empresaNombre} -> Key: ${newLicenseKey} (${datosB2B.cantidadLicencias} puestos)`);

              // 📧 ENVÍO DE CORREO CORPORATIVO AL CLIENTE B2B
              if (payerEmail && payerEmail !== 'suscriptor_b2b@local') {
                const logoUrl = process.env.LOGO_URL || 'https://lh3.googleusercontent.com/d/1GtxY0-91lcxLod1uEqtQCpVJSdWInUgk';

                const htmlB2B = `
                  <!DOCTYPE html>
                  <html lang="es">
                  <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  </head>
                  <body style="margin: 0; padding: 0; background-color: #f4f6f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
                    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f4f6f9; padding: 30px 0;">
                      <tr>
                        <td align="center">
                          <table border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
                            <tr>
                              <td align="center" style="background-color: #0f172a; padding: 25px 20px;">
                                <img src="${logoUrl}" alt="Copilot.ai" width="350" style="display: block; border: 0; max-width: 90%; height: auto;">
                              </td>
                            </tr>
                            <tr>
                              <td style="background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); padding: 25px 30px; text-align: center; color: #ffffff;">
                                <h1 style="margin: 0; font-size: 22px; font-weight: 700;">Suscripción Empresarial B2B Activada 🏢</h1>
                                <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.9;">Acceso corporativo asignado para <strong>${datosB2B.empresaNombre}</strong></p>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding: 35px 30px; color: #334155; font-size: 15px; line-height: 1.6;">
                                <p style="margin-top: 0;">Estimado equipo de <strong>${datosB2B.empresaNombre}</strong>,</p>
                                <p>Confirmamos que su pago de suscripción corporativa se ha procesado con éxito.</p>
                                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin: 25px 0;">
                                  <tr>
                                    <td style="padding: 20px; text-align: center;">
                                      <span style="font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase;">Clave de Licencia Matriz B2B</span>
                                      <div style="background-color: #ffffff; border: 2px dashed #2563eb; border-radius: 6px; padding: 12px 20px; font-family: 'Courier New', Courier, monospace; font-size: 22px; font-weight: bold; color: #1e40af; letter-spacing: 3px; margin: 12px 0;">
                                        ${newLicenseKey}
                                      </div>
                                      <div style="font-size: 13px; color: #64748b; margin-top: 5px;">
                                        👥 <strong>Capacidad corporativa:</strong> ${datosB2B.cantidadLicencias} puestos de trabajo
                                      </div>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </body>
                  </html>
                `;
                await enviarCorreoBrevo(payerEmail, newLicenseKey, `Tu Licencia Corporativa B2B - ${datosB2B.empresaNombre} 🚀`, htmlB2B);
              }

              // 📩 NOTIFICACIÓN PARA EL DUEÑO/ADMINISTRADOR (COMPRA B2B)
              const htmlAdminB2B = `
                <h2>🎉 ¡Nueva Compra B2B Recibida!</h2>
                <p><strong>Empresa:</strong> ${datosB2B.empresaNombre}</p>
                <p><strong>Email Comprador:</strong> ${payerEmail}</p>
                <p><strong>Puestos Contratados:</strong> ${datosB2B.cantidadLicencias}</p>
                <p><strong>Licencia Generada:</strong> ${newLicenseKey}</p>
                <p><strong>ID de Suscripción MP:</strong> ${preapprovalId}</p>
              `;
              await enviarCorreoBrevo(ADMIN_EMAIL, newLicenseKey, `🚨 [NUEVA VENTA B2B] ${datosB2B.empresaNombre}`, htmlAdminB2B);
            }

          } else {
            // 👤 CASO INDIVIDUAL
            let usuario = await License.findOne({ email: payerEmail });

            if (usuario) {
              usuario.status = 'active';
              usuario.plan = 'Pro (Mercado Pago)';
              usuario.expiresAt = expiresAt;
              usuario.preapprovalId = preapprovalId;
              await usuario.save();
              console.log(`✅ Suscripción renovada/activada para: ${payerEmail}`);

              // 📩 NOTIFICACIÓN PARA EL DUEÑO/ADMINISTRADOR (RENOVACIÓN INDIVIDUAL)
              const htmlAdminRenovacion = `
                <h2>🔄 Renovación de Suscripción Exitosa</h2>
                <p><strong>Cliente:</strong> ${payerEmail}</p>
                <p><strong>Plan:</strong> Pro (Mercado Pago)</p>
                <p><strong>Nueva Fecha de Vencimiento:</strong> ${expiresAt.toLocaleDateString()}</p>
              `;
              await enviarCorreoBrevo(ADMIN_EMAIL, usuario.licenseKey, `🔄 [RENOVACIÓN PLAN PRO] ${payerEmail}`, htmlAdminRenovacion);

            } else {
              let licenciaExistentePorSub = await License.findOne({ preapprovalId: preapprovalId });
              if (!licenciaExistentePorSub) {
                const newLicenseKey = generateLicenseKey('PRES');
                await License.create({
                  licenseKey: newLicenseKey,
                  status: 'active',
                  plan: 'Pro (Mercado Pago)',
                  usageCount: 0,
                  tokensUsados: 0,
                  limiteTokens: 999999,
                  email: payerEmail || 'suscriptor_mercadopago@local',
                  expiresAt,
                  preapprovalId: preapprovalId
                });
                console.log(`✅ Nueva licencia creada para: ${payerEmail} -> Key: ${newLicenseKey}`);
                
                // 📧 ENVÍO DE CORREO AL CLIENTE INDIVIDUAL
                if (payerEmail && payerEmail !== 'suscriptor_mercadopago@local') {
                  await enviarCorreoBrevo(payerEmail, newLicenseKey);
                }

                // 📩 NOTIFICACIÓN PARA EL DUEÑO/ADMINISTRADOR (NUEVA COMPRA INDIVIDUAL)
                const htmlAdminNuevo = `
                  <h2>💰 ¡Nueva Suscripción Individual Recibida!</h2>
                  <p><strong>Cliente:</strong> ${payerEmail}</p>
                  <p><strong>Plan:</strong> Pro (Mercado Pago)</p>
                  <p><strong>Licencia Asignada:</strong> ${newLicenseKey}</p>
                  <p><strong>ID de Suscripción MP:</strong> ${preapprovalId}</p>
                `;
                await enviarCorreoBrevo(ADMIN_EMAIL, newLicenseKey, `🎉 [NUEVA VENTA PRO] ${payerEmail}`, htmlAdminNuevo);
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

          // 📩 NOTIFICACIÓN PARA EL DUEÑO/ADMINISTRADOR (CANCELACIÓN O IMPAGO)
          const htmlAdminCancelado = `
            <h2>⚠️ Suscripción Cancelada / Pausada</h2>
            <p><strong>Cliente:</strong> ${payerEmail}</p>
            <p><strong>Estado MP:</strong> ${status}</p>
            <p>El acceso de este usuario ha sido desactivado automáticamente.</p>
          `;
          await enviarCorreoBrevo(ADMIN_EMAIL, 'N/A', `⚠️ [SUSCRIPCIÓN CANCELADA] ${payerEmail}`, htmlAdminCancelado);
        }
      }
    }

    res.status(200).send('Webhook procesado correctamente');
  } catch (error) {
    console.error('Error procesando webhook de Mercado Pago:', error.message);
    res.status(500).json({ error: 'Error procesando webhook' });
  }
});

// ENDPOINT DE PRUEBA MANUAL (Borrar o comentar después de probar)
app.get('/api/test-proceso-pago', async (req, res) => {
  try {
    const emailPrueba = "adriel.dul.music@gmail.com"; // El correo donde quieres recibir la prueba
    const empresaPrueba = "plus";
    const newLicenseKey = generateLicenseKey('B2B');
    
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 35);

    // 1. Guardar en MongoDB
    const nuevaLicenciaCorporativa = new License({
      licenseKey: newLicenseKey,
      status: 'active',
      plan: `Empresarial B2B - ${empresaPrueba} (1 Cuentas)`,
      usageCount: 0,
      tokensUsados: 0,
      limiteTokens: 999999,
      maxActivations: 1,
      currentActivations: 0,
      email: emailPrueba,
      expiresAt,
      preapprovalId: "TEST_MANUAL_123"
    });

    await nuevaLicenciaCorporativa.save();

    // 2. Enviar correo con Brevo
    const htmlB2B = `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>¡Prueba de Automatización Exitosa! 🎉</h2>
        <p>Esta es una simulación del correo B2B para la empresa <strong>${empresaPrueba}</strong>.</p>
        <p>Tu clave de licencia generada es:</p>
        <h3 style="color: #2563eb;">${newLicenseKey}</h3>
      </div>
    `;
    
    await enviarCorreoBrevo(emailPrueba, newLicenseKey, `Prueba Exitosa B2B - ${empresaPrueba}`, htmlB2B);

    res.json({ success: true, message: "Licencia creada y correo de prueba enviado con éxito.", licenseKey: newLicenseKey });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
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

// ... (Aquí van todas tus rutas y endpoints actuales) ...

// ==========================================
// TAREA PROGRAMADA: Avisar 3 días antes de la renovación
// ==========================================
cron.schedule('0 8 * * *', async () => {
  console.log('⏰ Ejecutando revisión de suscripciones próximas a vencer...');
  try {
    const hoy = new Date();
    const tresDiasDespues = new Date();
    tresDiasDespues.setDate(hoy.getDate() + 3);

    const inicioDia = new Date(tresDiasDespues.setHours(0, 0, 0, 0));
    const finDia = new Date(tresDiasDespues.setHours(23, 59, 59, 999));

    const licenciasPorVencer = await License.find({
      expiresAt: { $gte: inicioDia, $lte: finDia },
      status: 'active'
    });

    for (const licencia of licenciasPorVencer) {
      if (licencia.email && !licencia.email.includes('@local')) {
        const htmlAviso = `
          <h2>Tu suscripción vence en 3 días ⏳</h2>
          <p>Hola,</p>
          <p>Te recordamos que tu suscripción para la clave de licencia <strong>${licencia.licenseKey}</strong> se renovará el <strong>${licencia.expiresAt.toLocaleDateString()}</strong>.</p>
          <p>Asegúrate de contar con fondos disponibles en tu tarjeta/método de pago para mantener el servicio activo sin interrupciones.</p>
        `;

        await enviarCorreoBrevo(
          licencia.email, 
          licencia.licenseKey, 
          '⏳ Tu suscripción está próxima a renovarse (3 días)', 
          htmlAviso
        );
        console.log(`📧 Recordatorio enviado a: ${licencia.email}`);
      }
    }
  } catch (error) {
    console.error('❌ Error enviando recordatorios de renovación:', error.message);
  }
});

// ==========================================
// INICIALIZACIÓN DEL SERVIDOR
// ==========================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 Servidor AI Copilot corriendo en puerto ${PORT}`);
  console.log(`==================================================\n`);
});

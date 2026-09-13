import { db } from '../lib/firebaseAdmin.js';
import { verifyAuth } from '../lib/auth.js';
import { sanitizePayload } from '../lib/sanitize.js';
import { Resend } from 'resend';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { Buffer } from 'buffer';

// Descarga logoprincipal.png desde el propio sitio (misma raíz donde el
// frontend lo referencia como <img src="logoprincipal.png">) para poder
// incrustarlo en los PDFs. Si algo falla, devuelve null y el PDF se genera
// sin logo (nunca rompe el envío).
async function obtenerLogoBytes(request) {
    try {
        const proto = request.headers['x-forwarded-proto'] || 'https';
        const host = request.headers['x-forwarded-host'] || request.headers.host;
        const url = process.env.LOGO_URL || `${proto}://${host}/logoprincipal.png`;
        const res = await fetch(url);
        if (!res.ok) { console.error('[logo] No se pudo descargar el logo. Status', res.status, url); return null; }
        const ab = await res.arrayBuffer();
        return new Uint8Array(ab);
    } catch (e) {
        console.error('[logo] Error descargando el logo:', e.message);
        return null;
    }
}

// Dibuja el logo arriba a la derecha, respetando su proporción. No rompe si falla.
async function dibujarLogo(pdfDoc, page, logoBytes, alturaObjetivo, margin) {
    if (!logoBytes) return;
    try {
        const { width, height } = page.getSize();
        const logo = await pdfDoc.embedPng(logoBytes);
        const escala = alturaObjetivo / logo.height;
        const w = logo.width * escala;
        page.drawImage(logo, { x: width - margin - w, y: height - 18 - alturaObjetivo, width: w, height: alturaObjetivo });
    } catch (e) {
        console.error('[logo] No se pudo incrustar el logo en el PDF:', e.message);
    }
}

async function crearPDFValidacionSesion(nombre, fecha, tarea, firmaB64, userAgent, logoBytes) {
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let y = height - 50;
    const margin = 50;
    const brandColor = rgb(0.231, 0.302, 0.302);
    const maxWidth = width - 2 * margin;

    await dibujarLogo(pdfDoc, page, logoBytes, 45, margin);

    page.drawText('Psic. Laura Jiménez Rivero', { x: margin, y, font: boldFont, size: 12, color: brandColor });
    page.drawLine({ start: { x: margin, y: y - 10 }, end: { x: width - margin, y: y - 10 }, thickness: 1, color: brandColor });
    y -= 40;

    page.drawText('Certificado de Validación de Sesión', { x: margin, y, font: boldFont, size: 16, color: brandColor });
    y -= 40;

    page.drawText('Paciente:', { x: margin, y, font: boldFont, size: 11 });
    page.drawText(nombre || 'No registrado', { x: margin + 120, y, font, size: 11 });
    y -= 25;

    page.drawText('Fecha de Sesión:', { x: margin, y, font: boldFont, size: 11 });
    page.drawText(fecha || 'No registrada', { x: margin + 120, y, font, size: 11 });
    y -= 40;

    page.drawText('Tarea Consignada:', { x: margin, y, font: boldFont, size: 11, color: brandColor });
    y -= 20;

    const words = (tarea || 'Sin registro de tarea.').split(' ');
    let line = '';
    page.drawText('"', { x: margin, y, font: font, size: 11, color: rgb(0.2, 0.2, 0.2) });
    let textY = y;
    let textX = margin + 8;
    for (const word of words) {
        const testLine = line + word + ' ';
        const testWidth = font.widthOfTextAtSize(testLine, 11);
        if (testWidth > maxWidth - 15 && line !== '') {
            page.drawText(line, { x: textX, y: textY, font: font, size: 11, color: rgb(0.2, 0.2, 0.2) });
            textY -= 16;
            line = word + ' ';
            textX = margin + 8;
        } else {
            line = testLine;
        }
    }
    if (line.trim() !== '') {
        page.drawText(line + '"', { x: textX, y: textY, font: font, size: 11, color: rgb(0.2, 0.2, 0.2) });
        textY -= 40;
    }
    y = textY;

    page.drawText('Firma del Paciente:', { x: margin, y, font: boldFont, size: 12 });
    y -= 90;

    try {
        const pngImageBytes = Buffer.from(firmaB64.split(',')[1], 'base64');
        const pngImage = await pdfDoc.embedPng(pngImageBytes);
        page.drawImage(pngImage, { x: margin, y, width: 150, height: 75 });
    } catch (e) { console.error("Error incrustando firma en PDF", e); }

    page.drawLine({ start: { x: margin, y: y - 5 }, end: { x: margin + 200, y: y - 5 }, thickness: 1 });
    y -= 30;

    page.drawText('Sello Criptográfico (No Repudio):', { x: margin, y, font: boldFont, size: 9, color: rgb(0.5, 0.5, 0.5) });
    y -= 15;
    const timestamp = new Date().toISOString();
    page.drawText(`Fecha/Hora de validación: ${timestamp}`, { x: margin, y, font, size: 8, color: rgb(0.5, 0.5, 0.5) });
    y -= 15;
    page.drawText(`Dispositivo (User-Agent): ${userAgent.substring(0, 90)}...`, { x: margin, y, font, size: 8, color: rgb(0.5, 0.5, 0.5) });

    return await pdfDoc.save();
}

async function crearPDFReciboCaja(nombre, fecha, valor, logoBytes) {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 400]);
    const { width, height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let y = height - 50;
    const margin = 50;
    const brandColor = rgb(0.231, 0.302, 0.302);

    await dibujarLogo(pdfDoc, page, logoBytes, 38, margin);

    page.drawText('Psic. Laura Jiménez Rivero', { x: margin, y, font: boldFont, size: 16, color: brandColor });
    y -= 20;
    page.drawText('TP: 216453', { x: margin, y, font: font, size: 10, color: rgb(0.4, 0.4, 0.4) });
    y -= 15;
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: brandColor });

    y -= 40;
    page.drawText('RECIBO DE PAGO', { x: width / 2 - 70, y, font: boldFont, size: 18, color: brandColor });

    y -= 50;
    page.drawText('Fecha del Servicio:', { x: margin, y, font: boldFont, size: 12 });
    page.drawText(fecha, { x: 200, y, font: font, size: 12 });

    y -= 30;
    page.drawText('Paciente:', { x: margin, y, font: boldFont, size: 12 });
    page.drawText(nombre, { x: 200, y, font: font, size: 12 });

    y -= 30;
    page.drawText('Concepto:', { x: margin, y, font: boldFont, size: 12 });
    page.drawText('Servicios Profesionales en Psicología', { x: 200, y, font: font, size: 12 });

    y -= 40;
    const formatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });
    const valorFormateado = formatter.format(Number(valor));

    page.drawRectangle({ x: width - margin - 200, y: y - 10, width: 200, height: 40, color: rgb(0.95, 0.97, 1) });
    const etiquetaValorX = width - margin - 190;
    const etiquetaValorY = y + 5;
    page.drawText('VALOR PAGADO:', { x: etiquetaValorX, y: etiquetaValorY, font: boldFont, size: 12, color: brandColor });
    const anchoEtiquetaValor = boldFont.widthOfTextAtSize('VALOR PAGADO:', 12);
    page.drawText(valorFormateado, { x: etiquetaValorX + anchoEtiquetaValor + 12, y: etiquetaValorY, font: boldFont, size: 14, color: rgb(0.1, 0.6, 0.3) });

    y -= 60;
    page.drawText('Este documento es un comprobante de pago emitido electrónicamente.', { x: margin, y, font: font, size: 9, color: rgb(0.5, 0.5, 0.5) });
    page.drawText('No constituye factura electrónica de venta.', { x: margin, y: y - 12, font: font, size: 9, color: rgb(0.5, 0.5, 0.5) });

    return await pdfDoc.save();
}

export default async function handler(request, response) {
    const { action, id, evoId } = request.query;

    const isPublicAction = (action === 'getPublicEvo' || action === 'saveEvoSignature');
    if (!isPublicAction) {
        if (!verifyAuth(request)) {
            return response.status(401).json({ message: 'Acceso Denegado. Sesión inválida, inexistente o expirada.' });
        }
    }

    try {
        if (request.method === 'GET') {
            if (action === 'getPublicEvo') {
                if (!id || !evoId) return response.status(400).json({ message: 'Faltan parámetros.' });

                const docHist = await db.collection('historias_clinicas').doc(id).get();
                if (!docHist.exists) return response.status(404).json({ message: 'Historia no encontrada.' });

                const dataHist = docHist.data();
                let fechaEvo, tareaEvo, yaFirmadoEvo;

                if (evoId === 'sesionCero') {
                    fechaEvo = dataHist.fechaSesionCero || new Date().toISOString().split('T')[0];
                    tareaEvo = dataHist.tareaSesionCero || dataHist.cierreSesionCero || 'No se consignó tarea en la sesión inicial.';
                    yaFirmadoEvo = !!dataHist.firmaSesionCero;
                } else {
                    const evolucion = (dataHist.evoluciones || []).find(e => e.id === evoId);
                    if (!evolucion) return response.status(404).json({ message: 'Sesión no encontrada.' });
                    fechaEvo = evolucion.fecha;
                    tareaEvo = evolucion.tarea || evolucion.cierre || 'No se consignó tarea en esta sesión.';
                    yaFirmadoEvo = !!evolucion.firmaPaciente;
                }

                let nombrePaciente = "Paciente";
                const docIndiv = await db.collection('consents').doc(id).get();
                if (docIndiv.exists) {
                    nombrePaciente = docIndiv.data().demograficos?.nombre || "Paciente";
                } else {
                    const docPareja = await db.collection('consents_parejas').doc(id).get();
                    if (docPareja.exists) {
                        const d = docPareja.data();
                        const n1 = d.paciente1?.nombre || d.demograficos?.nombreCompleto1 || "P1";
                        const n2 = d.paciente2?.nombre || d.demograficos?.nombreCompleto2 || "P2";
                        nombrePaciente = `${n1.split(' ')[0]} y ${n2.split(' ')[0]}`;
                    }
                }

                return response.status(200).json({
                    fecha: fechaEvo,
                    tarea: tareaEvo,
                    nombre: nombrePaciente,
                    yaFirmado: yaFirmadoEvo
                });
            }

            if (!id) return response.status(400).json({ message: 'Falta el ID del paciente.' });
            const doc = await db.collection('historias_clinicas').doc(id).get();
            if (!doc.exists) return response.status(200).json({ isNew: true });
            return response.status(200).json(doc.data());
        }

        if (request.method === 'POST') {
            const data = sanitizePayload(request.body);

            if (action === 'saveEvoSignature') {
                if (!data.pacienteId || !data.evoId || !data.firmaDigital) return response.status(400).json({ message: 'Faltan datos de firma.' });

                const docRef = db.collection('historias_clinicas').doc(data.pacienteId);
                const doc = await docRef.get();
                if (!doc.exists) return response.status(404).json({ message: 'Historia no encontrada.' });

                const dataHist = doc.data();
                let fechaSesionMail = "";
                let tareaSesionMail = "";

                if (data.evoId === 'sesionCero') {
                    await docRef.set({
                        firmaSesionCero: data.firmaDigital,
                        fechaFirmaSesionCero: new Date().toISOString(),
                        userAgentFirmaSesionCero: request.headers['user-agent'] || 'Desconocido'
                    }, { merge: true });
                    fechaSesionMail = dataHist.fechaSesionCero || new Date().toISOString().split('T')[0];
                    tareaSesionMail = dataHist.tareaSesionCero || dataHist.cierreSesionCero || 'No se consignó tarea en la sesión inicial.';
                } else {
                    let evoluciones = dataHist.evoluciones || [];
                    const evoIndex = evoluciones.findIndex(e => e.id === data.evoId);
                    if (evoIndex === -1) return response.status(404).json({ message: 'Evolución no encontrada.' });

                    evoluciones[evoIndex].firmaPaciente = data.firmaDigital;
                    evoluciones[evoIndex].fechaFirmaPaciente = new Date().toISOString();
                    evoluciones[evoIndex].userAgentFirma = request.headers['user-agent'] || 'Desconocido';

                    await docRef.set({ evoluciones: evoluciones }, { merge: true });
                    fechaSesionMail = evoluciones[evoIndex].fecha;
                    tareaSesionMail = evoluciones[evoIndex].tarea || evoluciones[evoIndex].cierre || 'No se consignó tarea.';
                }

                const resendApiKey = process.env.RESEND2_API_KEY;
                if (resendApiKey) {
                    const resend = new Resend(resendApiKey);
                    let emailPaciente = "";
                    let nombreCompleto = "";

                    const docIndiv = await db.collection('consents').doc(data.pacienteId).get();
                    if (docIndiv.exists) {
                        emailPaciente = docIndiv.data().demograficos?.email;
                        nombreCompleto = docIndiv.data().demograficos?.nombre;
                    } else {
                        const docPareja = await db.collection('consents_parejas').doc(data.pacienteId).get();
                        if (docPareja.exists) {
                            emailPaciente = docPareja.data().paciente1?.email || docPareja.data().demograficos?.email1;
                            nombreCompleto = "Terapia de Pareja";
                        }
                    }

                    if (emailPaciente) {
                        const nombreSeguro = nombreCompleto || 'Paciente';
                        const fechaSesionF = new Date(`${fechaSesionMail}T12:00:00`).toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
                        const userAgentString = request.headers['user-agent'] || 'Desconocido';
                        const logoBytes = await obtenerLogoBytes(request);
                        const pdfBuffer = await crearPDFValidacionSesion(nombreSeguro, fechaSesionF, tareaSesionMail, data.firmaDigital, userAgentString, logoBytes);

                        const htmlPaciente = `
                            <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 10px; overflow: hidden;">
                                <div style="background-color: #3B4D4D; padding: 20px; text-align: center;">
                                    <h2 style="color: white; margin: 0;">Certificado de Validación</h2>
                                </div>
                                <div style="padding: 30px;">
                                    <h3 style="color: #3B4D4D;">¡Sesión validada exitosamente!</h3>
                                    <p>Hola <strong>${nombreSeguro}</strong>,</p>
                                    <p>Este correo confirma que tu firma ha sido anexada a tu historia clínica para la sesión del <strong>${fechaSesionF}</strong>.</p>
                                    <p>Adjunto encontrarás el certificado PDF con la tarea consignada.</p>
                                    <p style="font-size: 12px; color: #666; margin-top: 30px;">Vincula</p>
                                </div>
                            </div>
                        `;

                        const { error: errFirmaPaciente } = await resend.emails.send({
                            from: 'Vincula <psic@lauravjimenez.com>',
                            to: emailPaciente,
                            subject: `✅ Certificado de Sesión Realizada - ${fechaSesionF}`,
                            html: htmlPaciente,
                            attachments: [{ filename: `Validacion-${fechaSesionMail}.pdf`, content: Buffer.from(pdfBuffer) }]
                        });
                        if (errFirmaPaciente) console.error('[saveEvoSignature] Resend rechazó el correo al paciente:', errFirmaPaciente);

                        const { error: errFirmaPsico } = await resend.emails.send({
                            from: 'Sistema CInformado <psic@lauravjimenez.com>',
                            to: 'psic@lauravjimenez.com',
                            subject: `✅ Validación de Sesión: ${nombreSeguro}`,
                            html: `<p>El paciente ha validado la sesión. Puedes revisar el certificado en tu bandeja.</p>`,
                            attachments: [{ filename: `Validacion-${nombreSeguro.replace(/\s+/g, '')}-${fechaSesionMail}.pdf`, content: Buffer.from(pdfBuffer) }]
                        });
                        if (errFirmaPsico) console.error('[saveEvoSignature] Resend rechazó la copia al psicólogo:', errFirmaPsico);
                    }
                }
                return response.status(200).json({ message: 'Firma guardada correctamente.' });
            }

            // ============================================================
            // ACCIÓN DEDICADA PARA EL RECIBO DE PAGO
            // Homologada al flujo de la firma: se dispara explícitamente,
            // arma el PDF (con logo) y envía con await. Idempotente vía el
            // mapa "recibosEnviados" (merge). Con 'forzar: true' (botón
            // Reenviar recibo) se salta el candado.
            //
            // El SDK de Resend NO lanza excepción cuando la API rechaza el
            // envío; devuelve { data, error }. Por eso revisamos 'error' y
            // solo reportamos éxito si de verdad salió.
            // ============================================================
            if (action === 'enviarReciboPago') {
                if (!data.pacienteId || !data.evoId) return response.status(400).json({ message: 'Faltan datos para el recibo.' });

                const docRef = db.collection('historias_clinicas').doc(data.pacienteId);
                const doc = await docRef.get();
                if (!doc.exists) return response.status(404).json({ message: 'Historia no encontrada.' });

                const dataHist = doc.data();
                let fechaRecibo = "";
                let valorRecibo = 0;

                if (data.evoId === 'sesionCero') {
                    fechaRecibo = dataHist.fechaSesionCero || new Date().toISOString().split('T')[0];
                    valorRecibo = dataHist.valorSesionCero || 0;
                } else {
                    const evolucion = (dataHist.evoluciones || []).find(e => e.id === data.evoId);
                    if (!evolucion) return response.status(404).json({ message: 'Evolución no encontrada.' });
                    fechaRecibo = evolucion.fecha;
                    valorRecibo = evolucion.valor || 0;
                }

                if (!(Number(valorRecibo) > 0)) {
                    return response.status(200).json({ message: 'La sesión no tiene un valor mayor a 0; no se genera recibo.' });
                }

                const recibosEnviados = dataHist.recibosEnviados || {};
                if (recibosEnviados[data.evoId] && data.forzar !== true) {
                    return response.status(200).json({ message: 'El recibo de esta sesión ya fue enviado. Usa "Reenviar recibo" para forzar el reenvío.' });
                }

                const resendApiKey = process.env.RESEND2_API_KEY;
                if (!resendApiKey) {
                    console.error('[enviarReciboPago] Falta RESEND2_API_KEY: no se puede enviar el recibo.');
                    return response.status(500).json({ message: 'Servicio de correo no configurado (falta RESEND2_API_KEY en este proyecto).' });
                }

                const resend = new Resend(resendApiKey);
                let emailPaciente = "";
                let nombreCompleto = "";

                const docIndiv = await db.collection('consents').doc(data.pacienteId).get();
                if (docIndiv.exists) {
                    emailPaciente = docIndiv.data().demograficos?.email;
                    nombreCompleto = docIndiv.data().demograficos?.nombre;
                } else {
                    const docPareja = await db.collection('consents_parejas').doc(data.pacienteId).get();
                    if (docPareja.exists) {
                        emailPaciente = docPareja.data().paciente1?.email || docPareja.data().demograficos?.email1;
                        nombreCompleto = docPareja.data().paciente1?.nombre || "Paciente";
                    }
                }

                if (!emailPaciente) {
                    console.error(`[enviarReciboPago] No se encontró email del paciente ${data.pacienteId}: recibo NO enviado.`);
                    return response.status(200).json({ message: 'No se encontró el correo del paciente; el recibo no se envió.' });
                }

                const nombreSeguro = nombreCompleto || 'Paciente';
                const fechaFormat = new Date(`${fechaRecibo}T12:00:00`).toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
                const formatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });
                const logoBytes = await obtenerLogoBytes(request);
                const pdfBuffer = await crearPDFReciboCaja(nombreSeguro, fechaFormat, valorRecibo, logoBytes);

                const htmlCorreo = `<p>Estimado/a ${nombreSeguro},</p><p>Recibes tu comprobante de pago por los servicios profesionales en psicología correspondientes a la sesión del ${fechaFormat}.</p><p>Valor pagado: ${formatter.format(Number(valorRecibo))}.</p><p>Adjunto, encontrarás el PDF con el soporte de este pago para tus registros.</p>`

                const { data: envioData, error: envioError } = await resend.emails.send({
                    from: 'Psic. Laura Jiménez Rivero - Finanzas <psic@lauravjimenez.com>',
                    to: emailPaciente,
                    bcc: 'psic@lauravjimenez.com',
                    subject: `Comprobante de Pago - Sesión ${fechaFormat}`,
                    html: htmlCorreo,
                    attachments: [{ filename: `Recibo-${fechaRecibo}.pdf`, content: Buffer.from(pdfBuffer) }]
                });

                if (envioError) {
                    console.error('[enviarReciboPago] Resend RECHAZÓ el envío:', JSON.stringify(envioError));
                    const detalle = envioError.message || envioError.name || 'Error desconocido de Resend';
                    return response.status(502).json({ message: `El correo NO se envió. Resend respondió: ${detalle}` });
                }

                await docRef.set({
                    recibosEnviados: { [data.evoId]: new Date().toISOString() }
                }, { merge: true });

                console.log(`[enviarReciboPago] Recibo enviado a ${emailPaciente} (sesión ${fechaRecibo}, valor ${valorRecibo}). id Resend: ${envioData?.id || 'N/D'}`);
                return response.status(200).json({ message: 'Recibo enviado correctamente.' });
            }

            switch (action) {
                case 'saveHistoria':
                    if (!data.pacienteId) return response.status(400).json({ message: 'Falta ID.' });
                    const historiaData = {
                        fechaSesionCero: data.fechaSesionCero || '', valorSesionCero: Number(data.valorSesionCero) || 0, pagadoSesionCero: data.pagadoSesionCero === true,
                        contextoVital: { ocupacion: data.ocupacion || '', convivencia: data.convivencia || '', hobbies: data.hobbies || '', noHobbies: data.noHobbies || '', antecedentesMedicos: data.antecedentesMedicos || '' },
                        halcon: { motivoConsulta: data.motivoConsulta || '', habilidades: data.habilidades || '', aspiracion: data.aspiracion || '', creencias: data.creencias || '', construccion: data.construccion || '', orientacion: data.orientacion || '', nutricion: data.nutricion || '' },
                        cierreSesionCero: data.cierreSesionCero || '', acuerdoStrikes: data.acuerdoStrikes === true, ultimaActualizacion: new Date().toISOString()
                    };
                    await db.collection('historias_clinicas').doc(data.pacienteId).set(historiaData, { merge: true });
                    return response.status(200).json({ message: 'Sesión Cero guardada.' });

                case 'savePlan':
                    if (!data.pacienteId) return response.status(400).json({ message: 'Falta ID.' });
                    await db.collection('historias_clinicas').doc(data.pacienteId).set({ planTrabajo: data.planTrabajo || [], ultimaActualizacionPlan: new Date().toISOString() }, { merge: true });
                    return response.status(200).json({ message: 'Plan de trabajo guardado.' });

                case 'saveEvolucion':
                    // saveEvolucion SOLO guarda. El recibo se envía por la acción
                    // dedicada 'enviarReciboPago', que el frontend dispara al marcar pagado.
                    if (!data.pacienteId) return response.status(400).json({ message: 'Falta ID.' });
                    await db.collection('historias_clinicas').doc(data.pacienteId).set({
                        evoluciones: data.evoluciones || [],
                        strikes: data.strikes || 0,
                        ultimaActualizacionEvo: new Date().toISOString()
                    }, { merge: true });
                    return response.status(200).json({ message: 'Bitácora guardada.' });

                case 'savePerfil':
                    if (!data.pacienteId) return response.status(400).json({ message: 'Falta ID.' });
                    await db.collection('historias_clinicas').doc(data.pacienteId).set({ perfilEjecutivo: data.perfilEjecutivo || '', propositoVida: data.propositoVida || '', ultimaActualizacionPerfil: new Date().toISOString() }, { merge: true });
                    return response.status(200).json({ message: 'Perfil y propósito guardados.' });

                default:
                    return response.status(400).json({ message: 'Acción POST no reconocida.' });
            }
        }

        return response.status(405).json({ message: 'Método no soportado.' });

    } catch (error) {
        console.error("Error en controlador de historia:", error);
        return response.status(500).json({ message: 'Error interno del servidor.', detail: error.message });
    }
}

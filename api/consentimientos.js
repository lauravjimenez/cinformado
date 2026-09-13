import { db } from '../lib/firebaseAdmin.js';
import { verifyAuth } from '../lib/auth.js';
import { sanitizePayload } from '../lib/sanitize.js';
import { Resend } from 'resend';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { Buffer } from 'buffer';

// =======================================================
// MOTOR DE PAGINACIÓN Y DISEÑO PARA PDFs
// =======================================================
function setupPdfBuilder(pdfDoc, font, boldFont) {
    let page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    const margin = 42;
    const maxWidth = width - 2 * margin;
    let y = height - margin;
    const brandColor = rgb(0.231, 0.302, 0.302); 

    const checkPageBreak = (neededSpace) => {
        if (y < margin + neededSpace) {
            page = pdfDoc.addPage();
            y = height - margin;
            drawHeader();
        }
    };

    const drawHeader = () => {
        page.drawText('Psic. Laura Jiménez Rivero - Psicología que Transforma', { x: margin, y, font: boldFont, size: 10, color: brandColor });
        page.drawLine({ start: { x: margin, y: y - 5 }, end: { x: width - margin, y: y - 5 }, thickness: 1, color: brandColor });
        y -= 20;
    };

    const drawTitle = (text) => {
        checkPageBreak(30);
        page.drawText(text, { x: margin, y, font: boldFont, size: 15, color: brandColor });
        y -= 16;
    };

    const drawSubTitle = (text) => {
        checkPageBreak(25);
        y -= 6;
        page.drawText(text, { x: margin, y, font: boldFont, size: 11, color: brandColor });
        y -= 9;
    };

    const drawTextWrap = (text, size = 10, isBold = false) => {
        const fontToUse = isBold ? boldFont : font;
        const words = text.split(' ');
        let line = '';
        for (let word of words) {
            const testLine = line + word + ' ';
            const testWidth = fontToUse.widthOfTextAtSize(testLine, size);
            if (testWidth > maxWidth && line !== '') {
                checkPageBreak(size + 5);
                page.drawText(line, { x: margin, y, font: fontToUse, size, color: rgb(0.2, 0.2, 0.2) });
                y -= (size + 2);
                line = word + ' ';
            } else {
                line = testLine;
            }
        }
        if (line.trim() !== '') {
            checkPageBreak(size + 5);
            page.drawText(line, { x: margin, y, font: fontToUse, size, color: rgb(0.2, 0.2, 0.2) });
            y -= (size + 4);
        }
    };

    const drawClause = (title, text) => {
        checkPageBreak(30);
        page.drawText(title, { x: margin, y, font: boldFont, size: 9 });
        y -= 11;
        drawTextWrap(text, 9, false);
    };

    const drawDetail = (label, value) => {
        if (!value) return;
        checkPageBreak(15);
        page.drawText(`${label}:`, { x: margin, y, font: boldFont, size: 9, color: brandColor });
        
        const valueX = margin + 140;
        const valueMaxWidth = maxWidth - 140;
        const words = String(value).split(' ');
        let line = '';
        for(let word of words) {
            const testLine = line + word + ' ';
            const textWidth = font.widthOfTextAtSize(testLine, 9);
            if(textWidth > valueMaxWidth && line !== '') {
                page.drawText(line, { x: valueX, y, font, size: 9 });
                y -= 11;
                checkPageBreak(15);
                line = word + ' ';
            } else {
                line = testLine;
            }
        }
        page.drawText(line, { x: valueX, y, font, size: 9 });
        y -= 13;
    };

    const drawSignature = async (base64Image, name, subtitle) => {
        checkPageBreak(90);
        y -= 30; 
        try {
            const imageBytes = Buffer.from(base64Image.split(',')[1], 'base64');
            const pngImage = await pdfDoc.embedPng(imageBytes);
            page.drawImage(pngImage, { x: margin, y, width: 110, height: 48 });
        } catch (e) { console.error("Error incrustando firma", e); }
        
        page.drawLine({ start: { x: margin, y: y - 5 }, end: { x: margin + 180, y: y - 5 }, thickness: 1, color: brandColor });
        page.drawText(name, { x: margin, y: y - 16, font: boldFont, size: 10 });
        page.drawText(subtitle, { x: margin, y: y - 28, font: font, size: 9, color: rgb(0.4, 0.4, 0.4) });
        y -= 38;
    };

    const drawDualSignatures = async (b64_1, name1, b64_2, name2) => {
        checkPageBreak(90);
        y -= 30; 
        try {
            const img1Bytes = Buffer.from(b64_1.split(',')[1], 'base64');
            const png1 = await pdfDoc.embedPng(img1Bytes);
            page.drawImage(png1, { x: margin, y, width: 120, height: 60 });
            
            const img2Bytes = Buffer.from(b64_2.split(',')[1], 'base64');
            const png2 = await pdfDoc.embedPng(img2Bytes);
            page.drawImage(png2, { x: margin + 250, y, width: 120, height: 60 });
        } catch (e) { console.error("Error incrustando firmas", e); }
        
        page.drawLine({ start: { x: margin, y: y - 5 }, end: { x: margin + 180, y: y - 5 }, thickness: 1, color: brandColor });
        page.drawLine({ start: { x: margin + 250, y: y - 5 }, end: { x: margin + 430, y: y - 5 }, thickness: 1, color: brandColor });
        
        page.drawText(name1, { x: margin, y: y - 18, font: boldFont, size: 10 });
        page.drawText('Paciente 1', { x: margin, y: y - 30, font: font, size: 9, color: rgb(0.4, 0.4, 0.4) });
        
        page.drawText(name2, { x: margin + 250, y: y - 18, font: boldFont, size: 10 });
        page.drawText('Paciente 2', { x: margin + 250, y: y - 30, font: font, size: 9, color: rgb(0.4, 0.4, 0.4) });
        y -= 45;
    };

    drawHeader();
    return { drawTitle, drawSubTitle, drawTextWrap, drawClause, drawDetail, drawSignature, drawDualSignatures };
}

async function crearPDFConsentimiento(datos) {
    const { demograficos, firmaDigital } = datos;
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    const doc = setupPdfBuilder(pdfDoc, font, boldFont);
    doc.drawTitle('Consentimiento Informado Digital');
    
    const esMenor = parseInt(demograficos.edad, 10) < 18;
    const modalidad = datos.consentimiento?.modalidad || 'presencial';
    
    const intro = esMenor ? `Yo, ${demograficos.nombreAcudiente}, con documento ${demograficos.documentoAcudiente}, como ${demograficos.tipoAcudiente} de ${demograficos.nombre} (doc ${demograficos.documentoIdentidad}), declaro que:` : `Yo, ${demograficos.nombre}, con documento ${demograficos.documentoIdentidad}, declaro que:`;
    doc.drawTextWrap(intro, 10, true);

    doc.drawClause('2.1 Confidencialidad:', 'Entiendo, acepto y soy consciente del trabajo profesional que realizará la psicóloga designada, y que esta guardará una confidencialidad absoluta con el (la) paciente, la cual será inviolable, salvo que su integridad física se vea amenazada, y salvo los requerimientos de ley que así mismo pidan levantar la reserva profesional.');
    doc.drawClause('2.2 Propósito de la Intervención:', 'El propósito es realizar una evaluación y/o intervención psicológica, la cual se llevará a cabo utilizando técnicas y enfoques validados por la psicología como ciencia.');
    doc.drawClause('2.3 Naturaleza del Proceso:', 'Se me ha informado que el proceso puede incluir entrevistas, pruebas psicométricas y tareas inter-sesión, y que mi participación activa es fundamental para el éxito del mismo.');
    doc.drawClause('2.4 Proceso de evaluación:', esMenor ? 'Autorizo que le sean practicadas pruebas psicométricas y demás herramientas diagnósticas que la psicóloga designada así considere necesario, a fin de establecer cabal y puntualmente un diagnóstico asertivo sobre el motivo de consulta del (la) paciente menor de edad en consulta.' : 'Autorizo que sean practicadas pruebas psicométricas y demás herramientas diagnósticas que la psicóloga designada así considere necesario, a fin de establecer cabal y puntualmente un diagnóstico asertivo sobre el motivo de consulta.');
    doc.drawClause('2.5 Costos económicos:', esMenor ? 'Me comprometo como acudiente del (la) paciente menor de edad, a cubrir todos los gastos económicos en que se incurra con motivo de la atención que recibirá, habiendo recibido la información de forma clara y oportuna y habiendo tenido la oportunidad de aceptar o rechazar dichas atenciones psicológicas y los costos asociados.' : 'Me comprometo a cubrir todos los gastos económicos en que se incurra con motivo de la atención que recibiré, habiendo recibido la información de forma clara y oportuna y habiendo tenido la oportunidad de aceptar o rechazar dichas atenciones psicológicas y los costos asociados.');
    doc.drawClause('2.6 Tratamiento de Datos:', 'Autorizo el tratamiento de mis datos personales de acuerdo con la Ley 1581 de 2012 y la política de tratamiento de datos de "Psic. Laura Jiménez Rivero", la cual he podido consultar.');
    doc.drawClause('2.7 Declaración y Modalidad de la Sesión:', esMenor ? `Declaro y doy fe de que yo, ${demograficos.nombreAcudiente}, actuando como acudiente, he leído y comprendido este documento durante una sesión ${modalidad} con la Psicóloga Laura Jiménez Rivero, donde se me ha garantizado un espacio para hacer preguntas, las cuales han sido respondidas a mi entera satisfacción.` : `Declaro y doy fe de que yo, ${demograficos.nombre}, he leído y comprendido este documento durante una sesión ${modalidad} con la Psicóloga Laura Jiménez Rivero, donde se me ha garantizado un espacio para hacer preguntas, las cuales han sido respondidas a mi entera satisfacción.`);

    doc.drawSubTitle('Información Demográfica del Paciente');
    doc.drawDetail('Nombre Completo', demograficos.nombre);
    doc.drawDetail('Documento', `${demograficos.documentoIdentidad} (${demograficos.tipoDocumento})`);
    doc.drawDetail('Nacimiento / Edad', `${demograficos.fechaNacimiento} (${demograficos.edad} años)`);
    doc.drawDetail('Ubicación', `${demograficos.ciudad || ''}, ${demograficos.departamento || ''}, ${demograficos.pais}`);
    doc.drawDetail('Dirección', demograficos.direccion);
    doc.drawDetail('Contacto (Tel/Email)', `${demograficos.telefonoContacto} | ${demograficos.email}`);
    doc.drawDetail('Servicio de Salud / EPS', demograficos.eps);
    doc.drawDetail('Contacto de Emergencia', `${demograficos.contactoEmergenciaNombre} (Tel: ${demograficos.contactoEmergenciaTelefono})`);
    
    if(esMenor) {
        doc.drawSubTitle('Información del Acudiente Legal');
        doc.drawDetail('Nombre Acudiente', demograficos.nombreAcudiente);
        doc.drawDetail('Documento Acudiente', demograficos.documentoAcudiente);
        doc.drawDetail('Relación o Parentesco', demograficos.tipoAcudiente);
    }
    
    doc.drawSubTitle('Firma de Aceptación');
    await doc.drawSignature(firmaDigital, esMenor ? demograficos.nombreAcudiente : demograficos.nombre, 'Firma Electrónica Autorizada');
    
    return await pdfDoc.save();
}

async function crearPDFParejas(datos) {
    const { paciente1, paciente2, firmas } = datos;
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    const doc = setupPdfBuilder(pdfDoc, font, boldFont);
    doc.drawTitle('Consentimiento - Terapia de Pareja');
    
    const intro = `Nosotros, ${paciente1.nombre} (Doc: ${paciente1.documentoIdentidad}) y ${paciente2.nombre} (Doc: ${paciente2.documentoIdentidad}), declaramos voluntariamente que:`;
    doc.drawTextWrap(intro, 10, true);
    
    doc.drawClause('3.1 Confidencialidad y Secreto Compartido:', 'Entendemos, aceptamos y somos conscientes del trabajo profesional que realizará la psicóloga designada, y que esta guardará una confidencialidad absoluta con nosotros, la cual será inviolable, salvo que nuestra integridad física se vea amenazada, y salvo los requerimientos de ley que así mismo pidan levantar la reserva profesional.');
    doc.drawClause('3.2 Propósito de la Intervención:', 'El propósito es realizar una evaluación e intervención psicológica orientada a mejorar la dinámica relacional, utilizando técnicas validadas.');
    doc.drawClause('3.3 Naturaleza del Proceso:', 'Se nos ha informado que el proceso puede incluir entrevistas, pruebas psicométricas y tareas inter-sesión, y que nuestra participación activa es fundamental para el éxito del mismo.');
    doc.drawClause('3.4 Proceso de Evaluación:', 'Autorizamos que nos sean practicadas pruebas psicométricas y demás herramientas diagnósticas que la psicóloga designada así considere necesario, a fin de establecer cabal y puntualmente un diagnóstico asertivo sobre el motivo de consulta.');
    doc.drawClause('3.5 Costos Económicos:', 'Nos comprometemos de manera solidaria a cubrir todos los gastos económicos en que se incurra con motivo de la atención que recibiremos, habiendo recibido la información de forma clara y oportuna.');
    doc.drawClause('3.6 Tratamiento de Datos:', 'Autorizamos el tratamiento de nuestros datos personales de acuerdo con la Ley 1581 de 2012 y la política de tratamiento de datos de "Psic. Laura Jiménez Rivero".');
    
    const modalidad = datos.consentimiento?.modalidad || 'presencial';
    const decPareja = `Declaramos y damos fe de que nosotros, ${paciente1.nombre} y ${paciente2.nombre}, hemos leído y comprendido este documento durante una sesión ${modalidad} con la Psicóloga Laura Jiménez Rivero, donde se nos ha garantizado un espacio para hacer preguntas, las cuales han sido respondidas a nuestra entera satisfacción.`;
    doc.drawClause('3.7 Declaración y Modalidad de la Sesión:', decPareja);

    doc.drawSubTitle('Información: Paciente 1');
    doc.drawDetail('Nombre', paciente1.nombre);
    doc.drawDetail('Documento', `${paciente1.documentoIdentidad} (${paciente1.tipoDocumento})`);
    doc.drawDetail('Edad / Nacimiento', `${paciente1.edad} años (${paciente1.fechaNacimiento})`);
    doc.drawDetail('Ubicación y Dir.', `${paciente1.ciudad || ''}, ${paciente1.departamento || ''}, ${paciente1.pais} | ${paciente1.direccion}`);
    doc.drawDetail('Contacto (Tel/Email)', `${paciente1.telefonoContacto} | ${paciente1.email}`);
    doc.drawDetail('EPS', paciente1.eps);
    doc.drawDetail('Contacto Emergencia', `${paciente1.contactoEmergenciaNombre || 'No Registrado'} (Tel: ${paciente1.contactoEmergenciaTelefono || 'N/A'})`);
    
    doc.drawSubTitle('Información: Paciente 2');
    doc.drawDetail('Nombre', paciente2.nombre);
    doc.drawDetail('Documento', `${paciente2.documentoIdentidad} (${paciente2.tipoDocumento})`);
    doc.drawDetail('Edad / Nacimiento', `${paciente2.edad} años (${paciente2.fechaNacimiento})`);
    doc.drawDetail('Ubicación y Dir.', `${paciente2.ciudad || ''}, ${paciente2.departamento || ''}, ${paciente2.pais} | ${paciente2.direccion}`);
    doc.drawDetail('Contacto (Tel/Email)', `${paciente2.telefonoContacto} | ${paciente2.email}`);
    doc.drawDetail('EPS', paciente2.eps);
    doc.drawDetail('Contacto Emergencia', `${paciente2.contactoEmergenciaNombre || 'No Registrado'} (Tel: ${paciente2.contactoEmergenciaTelefono || 'N/A'})`);

    doc.drawSubTitle('Firmas de Aceptación Conjunta');
    await doc.drawDualSignatures(firmas.firma1, paciente1.nombre, firmas.firma2, paciente2.nombre);
    
    return await pdfDoc.save();
}

export default async function handler(request, response) {
    // DESACTIVAR EL CACHÉ ABSOLUTAMENTE PARA EVITAR FUGAS DE DATOS EN VERCEL
    response.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
    
    const action = request.query.action;

    const isPublicAction = (request.method === 'POST' && (action === 'saveIndividual' || action === 'savePareja'));

    if (!isPublicAction) {
        if (!verifyAuth(request)) {
            return response.status(401).json({ message: 'Acceso Denegado. Sesión inválida, inexistente o expirada.' });
        }
    }

    try {
        if (request.method === 'GET') {
            if (action === 'getAll') {
                const results = [];
                const snapshotIndividuales = await db.collection('consents').get(); 
                snapshotIndividuales.forEach(doc => {
                    const data = doc.data();
                    const d = data.demograficos || data || {};
                    const isOldCouple = data.tipo === 'pareja' || d.nombreCompleto1 !== undefined || d.nombre1 !== undefined;
                    
                    let docFecha = data.fecha || data.fechaDiligenciamiento || (data.consentimiento && data.consentimiento.fechaAceptacion) || '2024-01-01T00:00:00.000Z';

                    // 🚀 EXTRACCIÓN DEL ESTADO DEL TESTIMONIO
                    const estadoTestimonio = data.estadoTestimonio || null;

                    if (isOldCouple) {
                        const n1 = d.nombreCompleto1 || d.nombre1 || d.paciente1 || 'P1';
                        const n2 = d.nombreCompleto2 || d.nombre2 || d.paciente2 || 'P2';
                        results.push({ id: doc.id, nombre: `${n1} y ${n2}`, email: d.email1 || d.email || 'Sin Email', tipo: 'pareja', fecha: docFecha, estadoTestimonio });
                    } else {
                        results.push({ id: doc.id, nombre: d.nombreCompleto || d.nombre || 'Sin Nombre', email: d.email || 'Sin Email', tipo: 'individual', fecha: docFecha, estadoTestimonio });
                    }
                });

                const snapshotParejas = await db.collection('consents_parejas').get();
                snapshotParejas.forEach(doc => {
                    const data = doc.data();
                    let n1, n2, email;
                    
                    if (data.paciente1 && typeof data.paciente1 === 'object') {
                        n1 = data.paciente1.nombreCompleto1 || data.paciente1.nombre || 'P1';
                        n2 = data.paciente2?.nombreCompleto2 || data.paciente2?.nombre || 'P2';
                        email = data.paciente1.email1 || data.paciente1.email || 'Sin Email';
                    } else {
                        const d = data.demograficos || data || {};
                        n1 = d.nombreCompleto1 || d.nombre1 || d.paciente1 || 'P1';
                        n2 = d.nombreCompleto2 || d.nombre2 || d.paciente2 || 'P2';
                        email = d.email1 || d.email || 'Sin Email';
                    }

                    let docFecha = data.fecha || data.fechaDiligenciamiento || (data.consentimiento && data.consentimiento.fechaAceptacion) || '2024-01-01T00:00:00.000Z';
                    
                    // 🚀 EXTRACCIÓN DEL ESTADO DEL TESTIMONIO
                    const estadoTestimonio = data.estadoTestimonio || null;

                    results.push({ id: doc.id, nombre: `${n1} y ${n2}`, email: email, tipo: 'pareja', fecha: docFecha, estadoTestimonio });
                });

                results.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
                return response.status(200).json(results);
            }
            
            if (action === 'getIndividual') {
                const doc = await db.collection('consents').doc(request.query.id).get();
                if (!doc.exists) return response.status(404).json({ message: 'No encontrado' });
                return response.status(200).json({ id: doc.id, ...doc.data() });
            }
            
            if (action === 'getPareja') {
                const doc = await db.collection('consents_parejas').doc(request.query.id).get();
                if (!doc.exists) return response.status(404).json({ message: 'No encontrado' });
                return response.status(200).json({ id: doc.id, ...doc.data() });
            }
        }

        if (request.method === 'POST') {
            const data = sanitizePayload(request.body);
            
            const resendApiKey = process.env.RESEND2_API_KEY;
            const resend = resendApiKey ? new Resend(resendApiKey) : null;

            if (action === 'updateDemographics') {
                const { id, isPareja, datos } = data;
                if (!id || !datos) return response.status(400).json({ message: 'Faltan datos.' });
                
                if (isPareja) {
                    await db.collection('consents_parejas').doc(id).set({ paciente1: datos.paciente1, paciente2: datos.paciente2 }, { merge: true });
                } else {
                    await db.collection('consents').doc(id).set({ demograficos: datos.demograficos }, { merge: true });
                }
                return response.status(200).json({ message: 'Datos actualizados exitosamente.' });
            }

            if (action === 'saveIndividual') {
                if (!data.demograficos || !data.firmaDigital) return response.status(400).json({ message: 'Faltan datos críticos.' });
                
                const dataToSave = { ...data, fecha: new Date().toISOString(), estado: 'Firmado' };
                const docRef = await db.collection('consents').add(dataToSave);
                
                if (resend) {
                    const pdfBuffer = await crearPDFConsentimiento(dataToSave);
                    const mailToPaciente = {
                        from: 'Notificación Consentimiento Informado <psic@lauravjimenez.com>',
                        to: dataToSave.demograficos.email,
                        subject: `Copia de tu Consentimiento Informado - Psic. Laura Jiménez Rivero`,
                        html: `
                            <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 10px; overflow: hidden;">
                                <div style="background-color: #3B4D4D; padding: 20px; text-align: center;">
                                    <h2 style="color: white; margin: 0;">Consentimiento Informado</h2>
                                </div>
                                <div style="padding: 30px;">
                                    <h3 style="color: #3B4D4D;">Copia de tu consentimiento</h3>
                                    <p>Estimado/a <strong>${dataToSave.demograficos.nombre}</strong>,</p>
                                    <p>Recibes una copia de tu consentimiento informado para la atención psicológica.</p>
                                    <p>Adjunto encontrarás el PDF con tu firma y la totalidad de las cláusulas legales aceptadas.</p>
                                    <p style="font-size: 12px; color: #666; margin-top: 30px;">Psic. Laura Jiménez Rivero</p>
                                </div>
                            </div>
                        `,
                        attachments: [{ filename: `Consentimiento Informado - ${dataToSave.demograficos.nombre}.pdf`, content: Buffer.from(pdfBuffer) }]
                    };
                    const mailToTerapeuta = {
                        from: 'Notificación Consentimiento Informado <psic@lauravjimenez.com>',
                        to: 'psic@lauravjimenez.com', 
                        subject: `Nuevo Consentimiento Firmado: ${dataToSave.demograficos.nombre}`,
                        html: `<p>Has recibido un consentimiento firmado de <strong>${dataToSave.demograficos.nombre}</strong>.</p><p>Revisa el PDF adjunto para ver los datos completos y la firma.</p>`,
                        attachments: [{ filename: `Consentimiento Informado - ${dataToSave.demograficos.nombre}.pdf`, content: Buffer.from(pdfBuffer) }]
                    };
                    await Promise.all([ resend.emails.send(mailToPaciente), resend.emails.send(mailToTerapeuta) ]);
                }
                return response.status(200).json({ message: 'Procesado exitosamente', id: docRef.id });
            }

            if (action === 'savePareja') {
                if (!data.paciente1 || !data.firmas) return response.status(400).json({ message: 'Faltan datos críticos.' });
                
                const dataToSave = { ...data, fecha: new Date().toISOString(), estado: 'Firmado Pareja' };
                const docRef = await db.collection('consents_parejas').add(dataToSave);
                
                if (resend) {
                    const pdfBuffer = await crearPDFParejas(dataToSave);
                    const attachments = [{ filename: `Consentimiento Informado - ${dataToSave.paciente1.nombre} y ${dataToSave.paciente2.nombre}.pdf`, content: Buffer.from(pdfBuffer) }];
                    const correos = [
                        { to: dataToSave.paciente1.email, subject: 'Copia de Consentimiento de Pareja' },
                        { to: dataToSave.paciente2.email, subject: 'Copia de Consentimiento de Pareja' },
                        { to: 'psic@lauravjimenez.com', subject: `Nuevo Consentimiento Pareja: ${dataToSave.paciente1.nombre} y ${dataToSave.paciente2.nombre}` } 
                    ];

                    const emailPromises = correos.map(correo => resend.emails.send({
                        from: 'Notificación Consentimiento <psic@lauravjimenez.com>',
                        to: correo.to,
                        subject: correo.subject,
                        html: `<p>Adjunto encontrarás el PDF íntegro del consentimiento informado de terapia de pareja, incluyendo todas sus cláusulas y las firmas electrónicas.</p>`,
                        attachments: attachments
                    }));
                    await Promise.all(emailPromises);
                }
                return response.status(200).json({ message: 'Procesado exitosamente', id: docRef.id });
            }
        }

        // 🛡️ LÓGICA DE BORRADO DEFINITIVO
        if (request.method === 'DELETE' && action === 'delete') {
            const { id } = request.query;
            if (!id) return response.status(400).json({ message: 'Falta el ID del expediente.' });

            await db.collection('consents').doc(id).delete();
            await db.collection('consents_parejas').doc(id).delete();
            await db.collection('historias_clinicas').doc(id).delete();

            return response.status(200).json({ message: 'Expediente eliminado completamente de la base de datos.' });
        }

        return response.status(405).json({ message: 'Método o acción no soportada.' });

    } catch (error) {
        console.error("Error en el controlador maestro de consentimientos:", error);
        return response.status(500).json({ message: 'Error interno del servidor.', detail: error.message });
    }
}

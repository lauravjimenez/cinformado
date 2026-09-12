import { db } from '../lib/firebaseAdmin.js';
import { verifyAuth } from '../lib/auth.js';
import { sanitizePayload } from '../lib/sanitize.js';
import { Resend } from 'resend';

export default async function handler(request, response) {
    const { action } = request.query;

    try {
        // ==========================================
        // 1. GET: OBTENER RESEÑAS PÚBLICAS (Para el Muro)
        // ==========================================
        if (request.method === 'GET' && action === 'getPublicReviews') {
            const snapshot = await db.collection('valoraciones').where('estado', '==', 'Aprobado').get();
            let reviews = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                reviews.push({
                    id: doc.id,
                    autor: data.autor || 'Anónimo',
                    estrellas: data.estrellas,
                    comentario: data.comentario,
                    fecha: data.fecha
                });
            });
            reviews.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
            return response.status(200).json(reviews);
        }

        // ==========================================
        // 2. GET: OBTENER TODAS LAS RESEÑAS (Para panel administrativo)
        // ==========================================
        if (request.method === 'GET' && action === 'getAllAdmin') {
            if (!verifyAuth(request)) {
                return response.status(401).json({ message: 'Acceso Denegado. Sesión inválida.' });
            }

            const snapshot = await db.collection('valoraciones').get();
            let allReviews = [];
            snapshot.forEach(doc => {
                allReviews.push({
                    id: doc.id,
                    ...doc.data()
                });
            });
            
            allReviews.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
            return response.status(200).json(allReviews);
        }

        // ==========================================
        // 3. POST: ACTUALIZAR ESTADO (Aprobar u Ocultar)
        // ==========================================
        if (request.method === 'POST' && action === 'updateStatus') {
            if (!verifyAuth(request)) {
                return response.status(401).json({ message: 'Acceso Denegado. Sesión inválida.' });
            }
            
            const { id, estado } = sanitizePayload(request.body);
            if (!id || !estado) return response.status(400).json({ message: 'Datos incompletos.' });

            await db.collection('valoraciones').doc(id).update({ estado: estado });
            return response.status(200).json({ message: `Reseña actualizada a: ${estado}` });
        }

        // ==========================================
        // 4. DELETE: ELIMINAR RESEÑA
        // ==========================================
        if (request.method === 'DELETE' && action === 'deleteReview') {
            if (!verifyAuth(request)) {
                return response.status(401).json({ message: 'Acceso Denegado. Sesión inválida.' });
            }
            const { id } = request.query;
            if (!id) return response.status(400).json({ message: 'ID no proporcionado.' });

            await db.collection('valoraciones').doc(id).delete();
            return response.status(200).json({ message: 'Reseña eliminada permanentemente.' });
        }

        // ==========================================
        // 5. POST: ENVIAR SOLICITUD DE RESEÑA AL PACIENTE
        // ==========================================
        if (request.method === 'POST' && action === 'sendRequest') {
            if (!verifyAuth(request)) {
                return response.status(401).json({ message: 'Acceso Denegado. Sesión inválida.' });
            }

            const { id, nombre, email } = sanitizePayload(request.body);

            if (!id || !email) {
                return response.status(400).json({ message: 'Faltan datos del paciente para enviar el correo.' });
            }

            const resendApiKey = process.env.RESEND2_API_KEY;
            if (!resendApiKey) {
                return response.status(500).json({ message: 'Error de configuración: Falta API Key de correos.' });
            }

            const resend = new Resend(resendApiKey);
            const primerNombre = nombre ? nombre.split(' ')[0] : 'Estimado/a paciente';
            
            const protocol = request.headers['x-forwarded-proto'] || 'https';
            const host = request.headers['host'];
            const reviewLink = `${protocol}://${host}/dejar-valoracion.html?id=${id}`;

            const htmlCorreo = `
                <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 10px; overflow: hidden;">
                    <div style="background-color: #3B4D4D; padding: 30px; text-align: center;">
                        <h2 style="color: white; margin: 0;">Nos encantaría conocer tu experiencia</h2>
                    </div>
                    <div style="padding: 30px; background-color: #ffffff;">
                        <h3 style="color: #3B4D4D; font-size: 20px;">¡Hola, ${primerNombre}!</h3>
                        <p style="font-size: 16px; line-height: 1.6; color: #4A4A4A;">
                            Esperamos que te encuentres muy bien.<br><br>
                            El crecimiento y la mejora continua son fundamentales en <strong>Vincula</strong>. Por ello, te invitamos a compartir un breve testimonio sobre tu experiencia en nuestras sesiones.
                        </p>
                        <p style="font-size: 16px; line-height: 1.6; color: #4A4A4A;">
                            Tus palabras no solo nos ayudan a mejorar, sino que pueden ser la luz que otra persona necesita para dar el paso hacia su propio bienestar emocional.
                        </p>
                        
                        <div style="text-align: center; margin: 35px 0;">
                            <a href="${reviewLink}" style="background-color: #fbbf24; color: #78350f; text-decoration: none; padding: 14px 30px; border-radius: 50px; font-weight: bold; font-size: 16px; display: inline-block; box-shadow: 0 4px 6px rgba(251, 191, 36, 0.3);">
                                ⭐ Dejar mi Testimonio
                            </a>
                        </div>
                        
                        <p style="font-size: 13px; color: #6b7280; border-top: 1px solid #f3f4f6; padding-top: 15px;">
                            <em>Nota de Privacidad:</em> Tienes total libertad de usar tu nombre real o un seudónimo. Tu confidencialidad clínica sigue intacta.
                        </p>
                    </div>
                </div>
            `;

            await resend.emails.send({
                from: 'Vincula <psic@lauravjimenez.com>',
                to: email,
                subject: `⭐ ¿Cómo fue tu experiencia en Vincula?`,
                html: htmlCorreo
            });

            // 🚀 NUEVO: MARCAR EL ESTADO COMO 'SOLICITADO' EN EL PERFIL DEL PACIENTE
            const docIndiv = await db.collection('consents').doc(id).get();
            if (docIndiv.exists) {
                await db.collection('consents').doc(id).update({ estadoTestimonio: 'solicitado' });
            } else {
                const docPareja = await db.collection('consents_parejas').doc(id).get();
                if (docPareja.exists) {
                    await db.collection('consents_parejas').doc(id).update({ estadoTestimonio: 'solicitado' });
                }
            }

            return response.status(200).json({ message: 'Correo de solicitud de reseña enviado con éxito.' });
        }

        // ==========================================
        // 6. POST: RECIBIR Y GUARDAR LA RESEÑA
        // ==========================================
        if (request.method === 'POST' && action === 'submitReview') {
            const data = sanitizePayload(request.body);
            const { pacienteId, estrellas, comentario, seudonimo } = data;

            if (!pacienteId || !estrellas || !comentario) {
                return response.status(400).json({ message: 'La calificación y el comentario son obligatorios.' });
            }

            const valoracionData = {
                pacienteId: pacienteId,
                estrellas: Number(estrellas),
                comentario: comentario,
                autor: seudonimo || 'Anónimo',
                fecha: new Date().toISOString(),
                estado: 'Pendiente' 
            };

            await db.collection('valoraciones').add(valoracionData);

            // 🚀 NUEVO: MARCAR EL ESTADO COMO 'COMPLETADO' (Solo si no es un paciente antiguo de WhatsApp)
            if (pacienteId && !pacienteId.startsWith('paciente_legacy_')) {
                const docIndiv = await db.collection('consents').doc(pacienteId).get();
                if (docIndiv.exists) {
                    await db.collection('consents').doc(pacienteId).update({ estadoTestimonio: 'completado' });
                } else {
                    const docPareja = await db.collection('consents_parejas').doc(pacienteId).get();
                    if (docPareja.exists) {
                        await db.collection('consents_parejas').doc(pacienteId).update({ estadoTestimonio: 'completado' });
                    }
                }
            }

            return response.status(200).json({ message: 'Testimonio recibido y guardado en moderación.' });
        }

        return response.status(405).json({ message: 'Acción o método no soportado en Reviews.' });

    } catch (error) {
        console.error("Error en módulo de valoraciones:", error);
        return response.status(500).json({ message: 'Error interno del servidor.', detail: error.message });
    }
}

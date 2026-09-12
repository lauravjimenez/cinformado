import { db } from '../lib/firebaseAdmin.js';
import { verifyAuth } from '../lib/auth.js';

export default async function handler(request, response) {
    // 🛡️ CONTROL DE SEGURIDAD
    if (!verifyAuth(request)) {
        return response.status(401).json({ message: 'Acceso Denegado. Sesión inválida, inexistente o expirada.' });
    }

    if (request.method !== 'GET') {
        return response.status(405).json({ message: 'Método no permitido. Solo GET.' });
    }

    try {
        const patientsMap = {};
        
        const [indivSnap, parejaSnap, histSnap] = await Promise.all([
            db.collection('consents').get(),
            db.collection('consents_parejas').get(),
            db.collection('historias_clinicas').get()
        ]);

        // 1. Mapeo de Colección Individual (y Parejas Antiguas)
        indivSnap.forEach(doc => {
            const data = doc.data();
            const d = data.demograficos || data || {};
            
            if (data.tipo === 'pareja' || d.nombreCompleto1 !== undefined || d.nombre1 !== undefined) {
                const n1 = d.nombreCompleto1 || d.nombre1 || d.paciente1 || 'Paciente 1';
                const n2 = d.nombreCompleto2 || d.nombre2 || d.paciente2 || 'Paciente 2';
                patientsMap[doc.id] = `${n1.split(' ')[0]} y ${n2.split(' ')[0]}`;
            } else {
                patientsMap[doc.id] = d.nombreCompleto || d.nombre || 'Paciente Sin Nombre';
            }
        });

        // 2. Mapeo de Colección de Parejas Nuevas
        parejaSnap.forEach(doc => {
            const data = doc.data();
            let n1, n2;
            
            if (data.paciente1 && typeof data.paciente1 === 'object') {
                n1 = data.paciente1.nombreCompleto1 || data.paciente1.nombre || 'Paciente 1';
                n2 = data.paciente2?.nombreCompleto2 || data.paciente2?.nombre || 'Paciente 2';
            } else {
                const d = data.demograficos || data || {};
                n1 = d.nombreCompleto1 || d.nombre1 || d.paciente1 || 'Paciente 1';
                n2 = d.nombreCompleto2 || d.nombre2 || d.paciente2 || 'Paciente 2';
            }
            
            patientsMap[doc.id] = `${n1.split(' ')[0]} y ${n2.split(' ')[0]}`;
        });

        const pagosTotales = [];

        // 3. Extracción de pagos de la historia clínica
        histSnap.forEach(doc => {
            const data = doc.data();
            const pacienteId = doc.id;
            const nombre = patientsMap[pacienteId] || 'Paciente sin registro demográfico';
            const pagosPaciente = [];

            if (data.fechaSesionCero && data.valorSesionCero && Number(data.valorSesionCero) > 0 && data.pagadoSesionCero === true) {
                pagosPaciente.push({
                    fecha: data.fechaSesionCero,
                    valor: Number(data.valorSesionCero),
                    tipo: 'Sesión Cero'
                });
            }

            if (data.evoluciones && Array.isArray(data.evoluciones)) {
                data.evoluciones.forEach(evo => {
                    if (evo.fecha && evo.valor && Number(evo.valor) > 0 && evo.pagado === true) {
                        pagosPaciente.push({
                            fecha: evo.fecha,
                            valor: Number(evo.valor),
                            tipo: 'Evolución'
                        });
                    }
                });
            }

            if (pagosPaciente.length > 0) {
                pagosTotales.push({ pacienteId, nombre, pagos: pagosPaciente });
            }
        });

        return response.status(200).json(pagosTotales);

    } catch (error) {
        console.error("Error en el controlador de pagos:", error);
        return response.status(500).json({ message: 'Error interno del servidor.', detail: error.message });
    }
}

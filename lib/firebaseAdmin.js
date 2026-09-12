import admin from 'firebase-admin';
import { Buffer } from 'buffer';

// Esta función asegura que la inicialización de Firebase ocurra solo una vez.
function initializeFirebaseAdmin() {
    // Si ya hay una app de Firebase inicializada, la retornamos para no crear duplicados.
    if (admin.apps.length) {
        return admin.app();
    }

    // Leemos la variable de entorno que contiene la llave en Base64.
    // Esta variable debe estar configurada en Vercel (FIREBASE_SERVICE_ACCOUNT_BASE64).
    const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    if (!serviceAccountBase64) {
        console.error("CRITICAL: La variable de entorno FIREBASE_SERVICE_ACCOUNT_BASE64 no está definida.");
        // Lanzar un error para detener la ejecución de la función serverless si no hay clave.
        throw new Error('La configuración del servidor de Firebase no está completa.');
    }
    
    try {
        // Decodificamos la clave desde Base64 para que Firebase pueda leerla como JSON.
        const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf-8');
        const serviceAccount = JSON.parse(serviceAccountJson);

        // Inicializamos la app con las credenciales.
        return admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } catch (error) {
        console.error("Error al decodificar FIREBASE_SERVICE_ACCOUNT_BASE64:", error);
        throw new Error('La llave de la cuenta de servicio de Firebase está malformada o es inválida.');
    }
}

// Inicializamos la app y exportamos la instancia de Firestore.
// Esto permite que otros archivos (como save-consent.js) importen 'db' y la usen directamente.
const app = initializeFirebaseAdmin();
const db = admin.firestore();

export { db };

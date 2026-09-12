import jwt from 'jsonwebtoken';

/**
 * Función centralizada para verificar si la petición viene de un usuario autenticado.
 * Lee la cookie HttpOnly que inyecta authenticate.js y verifica su validez.
 */
export function verifyAuth(request) {
    // Leemos las cookies de los headers o directamente de Vercel
    const cookieHeader = request.headers.cookie;
    let token = request.cookies?.auth_token;

    if (!token && cookieHeader) {
        const cookies = Object.fromEntries(cookieHeader.split('; ').map(c => c.split('=')));
        token = cookies.auth_token;
    }
    
    if (!token) return false;

    try {
        // Utilizamos la misma llave secreta configurada en Vercel
        const jwtSecret = process.env.JWT_SECRET || 'VinculaLaura2026SecureKey';
        jwt.verify(token, jwtSecret);
        return true; // Token válido y no ha expirado
    } catch (error) {
        return false; // Token modificado, inválido o expirado
    }
}

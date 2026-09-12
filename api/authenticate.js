import jwt from 'jsonwebtoken';

export default async function handler(request, response) {
    const { action } = request.query;

    // Lógica para cerrar sesión (destruir la cookie)
    if (action === 'logout') {
        const cookieString = `auth_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict`;
        response.setHeader('Set-Cookie', cookieString);
        return response.status(200).json({ success: true, message: 'Sesión cerrada' });
    }

    if (request.method !== 'POST') {
        return response.status(405).json({ success: false, message: 'Método no permitido.' });
    }

    try {
        const { password } = request.body;
        const correctPassword = process.env.LOGIN_PASS;
        const jwtSecret = process.env.JWT_SECRET || 'VinculaLaura2026SecureKey';

        if (!correctPassword) {
            console.error("CRITICAL: La variable de entorno LOGIN_PASS no está configurada.");
            return response.status(500).json({ success: false, message: 'Error de configuración del servidor.' });
        }

        if (password === correctPassword) {
            // 1. Crear el token JWT encriptado, válido por 12 horas (jornada laboral)
            const token = jwt.sign({ admin: true }, jwtSecret, { expiresIn: '12h' });
            
            // 2. Configurar la cookie HttpOnly
            const isProd = process.env.NODE_ENV === 'production';
            const cookieString = `auth_token=${token}; HttpOnly; Path=/; Max-Age=43200; SameSite=Strict${isProd ? '; Secure' : ''}`;
            
            // 3. Enviar la cookie al navegador
            response.setHeader('Set-Cookie', cookieString);
            
            return response.status(200).json({ success: true });
        } else {
            return response.status(401).json({ success: false, message: 'Contraseña incorrecta.' });
        }

    } catch (error) {
        console.error("Error en la función de autenticación:", error);
        return response.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
}

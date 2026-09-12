/**
 * Neutraliza caracteres peligrosos de HTML para prevenir ataques XSS.
 */
export function sanitizeString(input) {
    if (typeof input !== 'string') return input;
    return input.replace(/[&<>"']/g, function(match) {
        const escape = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        };
        return escape[match];
    });
}

/**
 * Recorre recursivamente un objeto o array y sanitiza todos sus strings.
 */
export function sanitizePayload(obj) {
    if (typeof obj === 'string') return sanitizeString(obj);
    
    if (Array.isArray(obj)) {
        return obj.map(item => sanitizePayload(item));
    }
    
    if (typeof obj === 'object' && obj !== null) {
        const sanitizedObj = {};
        for (const key in obj) {
            sanitizedObj[key] = sanitizePayload(obj[key]);
        }
        return sanitizedObj;
    }
    
    return obj;
}

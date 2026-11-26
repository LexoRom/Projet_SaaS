export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (handler) => {
  onUnauthorized = handler;
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pendant une élection de primaire, l'API répond 503. Les lectures sont réessayées
 * automatiquement ; les écritures non, pour ne jamais les exécuter deux fois.
 */
export async function api(path, { method = 'GET', body } = {}) {
  const attempts = method === 'GET' ? 5 : 1;
  for (let attempt = 1; ; attempt += 1) {
    let response;
    try {
      response = await fetch(`/api${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      response = null;
    }

    if ((!response || response.status === 503) && attempt < attempts) {
      await wait(3000);
      continue;
    }
    if (!response) throw new ApiError(0, 'Le serveur ne répond pas');
    if (response.status === 204) return null;

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 && path !== '/auth/login') onUnauthorized();
      throw new ApiError(response.status, data?.error ?? `Erreur ${response.status}`);
    }
    return data;
  }
}

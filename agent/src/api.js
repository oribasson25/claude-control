/**
 * The agent's side of the wire. Every call carries the device token, which is
 * what tells the server whose outbox this is — the agent never names a user.
 */

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(config, method, pathname, body) {
  const url = new URL(pathname, config.server).toString();

  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${config.token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(response.status, payload.error ?? `HTTP ${response.status}`);
  }
  return payload;
}

/** Asks for the prompts this machine may deliver right now. */
export function fetchOutbox(config) {
  return request(config, "GET", "/api/outbox");
}

/** Reports what happened to one delivered prompt. */
export function ackItem(config, id, status, error) {
  return request(config, "POST", "/api/outbox/ack", { id, status, error });
}

export { HttpError };

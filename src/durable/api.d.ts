export function dispatch(method: string, pathname: string, input?: { body?: unknown; ip?: string; cookie?: string }): Promise<{ status: number; body: unknown; headers: Record<string, string> }>;

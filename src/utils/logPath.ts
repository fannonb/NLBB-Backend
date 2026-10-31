// Query strings can contain payment callback credentials or recovery tokens.
// Log only the route; never log query values, even for unknown parameter names.
export const logPath = (url: string) => url.split(/[?#]/, 1)[0];

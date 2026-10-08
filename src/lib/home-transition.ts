export type HomeState = { inside: boolean; at: number };

export function homeTransition(
    previous: HomeState | undefined,
    inside: boolean,
    now: number,
) {
    if (previous?.inside === inside) return { state: previous, notify: false };
    return {
        state: { inside, at: now },
        notify: Boolean(previous && now - previous.at >= 120000),
    };
}

export function isInsideHome(
    home: { latitude: number; longitude: number; radius: number },
    point: { latitude: number; longitude: number },
) {
    const radians = Math.PI / 180;
    const lat = (point.latitude - home.latitude) * radians;
    const lon = (point.longitude - home.longitude) * radians;
    const a =
        Math.sin(lat / 2) ** 2 +
        Math.cos(home.latitude * radians) *
            Math.cos(point.latitude * radians) *
            Math.sin(lon / 2) ** 2;
    return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a))) <= home.radius;
}

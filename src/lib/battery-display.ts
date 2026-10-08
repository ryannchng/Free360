/** Kept self-contained so the same rules can run in the embedded map. */
export function batteryDisplay(value: unknown) {
    if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 100
    )
        return null;
    const percent = Math.round(value);
    return {
        percent,
        label: `${percent}%`,
        color:
            percent <= 20 ? "#D92D42" : percent <= 50 ? "#C06B16" : "#178347",
    };
}

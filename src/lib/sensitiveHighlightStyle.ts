/** Tailwind class for inline text; background color for absolute PDF overlays. */

export function getSensitiveLabelClass(label: string | null | undefined): string {
	const key = String(label ?? '').toLowerCase();
	if (key.includes('email')) return 'bg-emerald-200/80 text-emerald-950 ring-emerald-300';
	if (key.includes('phone')) return 'bg-sky-200/80 text-sky-950 ring-sky-300';
	if (key.includes('person')) return 'bg-violet-200/80 text-violet-950 ring-violet-300';
	if (key.includes('address')) return 'bg-amber-200/80 text-amber-950 ring-amber-300';
	if (key.includes('date')) return 'bg-lime-200/80 text-lime-950 ring-lime-300';
	if (key.includes('url')) return 'bg-cyan-200/80 text-cyan-950 ring-cyan-300';
	if (key.includes('account')) return 'bg-fuchsia-200/80 text-fuchsia-950 ring-fuchsia-300';
	if (key.includes('secret')) return 'bg-rose-200/80 text-rose-950 ring-rose-300';
	return 'bg-slate-200 text-slate-950 ring-slate-300';
}

export function getSensitiveFillStyle(label: string | null | undefined): string {
	const key = String(label ?? '').toLowerCase();
	if (key.includes('email')) return 'rgba(16, 185, 129, 0.35)';
	if (key.includes('phone')) return 'rgba(14, 165, 233, 0.35)';
	if (key.includes('person')) return 'rgba(139, 92, 246, 0.35)';
	if (key.includes('address')) return 'rgba(245, 158, 11, 0.35)';
	if (key.includes('date')) return 'rgba(163, 230, 53, 0.35)';
	if (key.includes('url')) return 'rgba(6, 182, 212, 0.35)';
	if (key.includes('account')) return 'rgba(217, 70, 239, 0.35)';
	if (key.includes('secret')) return 'rgba(244, 63, 94, 0.35)';
	return 'rgba(100, 116, 139, 0.35)';
}

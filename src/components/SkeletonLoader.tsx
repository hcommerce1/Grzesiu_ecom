'use client';

export function SkeletonLoader() {
    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Title skeleton */}
            <div className="bg-card rounded-2xl border border-border p-6">
                <div className="skeleton h-4 w-20 mb-3 rounded" />
                <div className="skeleton h-7 w-3/4 mb-2 rounded" />
                <div className="skeleton h-7 w-1/2 rounded" />
            </div>

            {/* Images skeleton */}
            <div className="bg-card rounded-2xl border border-border p-6">
                <div className="skeleton h-4 w-24 mb-4 rounded" />
                <div className="flex gap-3 overflow-hidden">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="skeleton w-40 h-40 rounded-xl flex-shrink-0" />
                    ))}
                </div>
            </div>

            {/* Description skeleton */}
            <div className="bg-card rounded-2xl border border-border p-6">
                <div className="skeleton h-4 w-28 mb-4 rounded" />
                <div className="space-y-2">
                    <div className="skeleton h-4 w-full rounded" />
                    <div className="skeleton h-4 w-5/6 rounded" />
                    <div className="skeleton h-4 w-4/6 rounded" />
                    <div className="skeleton h-4 w-full rounded" />
                    <div className="skeleton h-4 w-3/6 rounded" />
                </div>
            </div>

            {/* Attributes skeleton */}
            <div className="bg-card rounded-2xl border border-border p-6">
                <div className="skeleton h-4 w-32 mb-4 rounded" />
                <div className="space-y-2">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="flex gap-4">
                            <div className="skeleton h-4 w-1/4 rounded" />
                            <div className="skeleton h-4 w-1/2 rounded" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

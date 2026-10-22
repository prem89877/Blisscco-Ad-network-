const BIDS = [
  { id: "cmp_8f3a21", brand: "Trailhead Gear", fit: 0.94 },
  { id: "cmp_41c9be", brand: "Peak Pantry", fit: 0.81 },
  { id: "cmp_07d5aa", brand: "Daybreak Travel", fit: 0.66 },
];

export default function Hero() {
  return (
    <section id="top" className="mx-auto grid max-w-6xl gap-12 px-5 pb-20 pt-16 md:grid-cols-2 md:items-center md:pt-24">
      <div>
        <h1 className="font-display text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
          Ads that answer the question being asked.
        </h1>
        <p className="mt-6 max-w-md text-lg text-mist/75">
          Blisscco matches advertisers to the topic of an AI chat, in the moment, and labels every placement as an ad.
          No user profiles needed.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <a href="#waitlist" className="rounded-lg bg-violet px-6 py-3 font-medium text-white hover:brightness-110">Join the waitlist</a>
          <a href="#developers" className="rounded-lg border border-aqua/60 px-6 py-3 font-medium text-aqua hover:bg-aqua/10">See the API</a>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
        <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-violet px-4 py-3 text-sm">
          Which waterproof jacket works for a rainy week in Munnar?
        </div>
        <div className="mt-3 max-w-[90%] rounded-2xl rounded-bl-sm bg-white/10 px-4 py-3 text-sm text-mist/90">
          Look for taped seams, a hood that adjusts, and a breathable membrane. Packable shells are easiest to carry.
        </div>
        <div className="mt-3 rounded-xl border border-aqua/40 bg-aqua/[0.07] p-4">
          <div className="flex items-center justify-between">
            <span className="rounded bg-aqua px-2 py-0.5 text-xs font-medium text-ink">Sponsored</span>
            <span className="font-mono text-xs text-aqua">cmp_8f3a21</span>
          </div>
          <p className="mt-2 font-medium">Trailhead Gear: taped-seam shell, 320 g</p>
          <p className="text-sm text-mist/70">Packs into its own pocket. Free returns.</p>
        </div>
        <div className="mt-4 border-t border-white/10 pt-3">
          <p className="mb-2 text-xs text-mist/60">Candidates matched to this topic</p>
          {BIDS.map((b, i) => (
            <div key={b.id} className="bid-row flex items-center gap-3 py-1 text-xs" style={{ animationDelay: `${0.4 + i * 0.35}s` }}>
              <span className="w-24 font-mono text-mist/60">{b.id}</span>
              <span className="w-28 truncate">{b.brand}</span>
              <span className="h-1.5 flex-1 rounded bg-white/10">
                <span className="block h-1.5 rounded bg-aqua" style={{ width: `${b.fit * 100}%` }} />
              </span>
              <span className="w-8 text-right font-mono text-mist/70">{b.fit.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

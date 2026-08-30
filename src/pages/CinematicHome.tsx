import { useEffect, useMemo, useRef, useState } from "react";
import { siteConfig } from "../site.config";
import { EnquirySection } from "../components/EnquirySection";
import type { CinematicSiteConfig, SiteProductItem } from "../types/site-config";

// The single-page, three-section cinematic experience described in
// docs/DEVIN_3D_WEBSITE_SPEC.md: a scroll-scrubbed photo-sequence hero, a
// scroll-driven horizontal products/services rail, and a normal-flow
// enquiry section. Everything is driven by siteConfig — no animation/3D
// libraries, no custom scrolling. Only rendered by App.tsx when
// siteConfig.variant === "cinematic".
export function CinematicHome({ config }: { config: CinematicSiteConfig }) {
  useEffect(() => {
    document.title = `${siteConfig.businessName} — ${siteConfig.purpose}`;
  }, []);

  const reducedMotion = usePrefersReducedMotion();

  return (
    <div id="top">
      <CinematicHero config={config} reducedMotion={reducedMotion} />
      <ProductsRail config={config} reducedMotion={reducedMotion} />
      <EnquirySection />
    </div>
  );
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.(REDUCED_MOTION_QUERY).matches,
  );

  useEffect(() => {
    const media = window.matchMedia?.(REDUCED_MOTION_QUERY);
    if (!media) return;
    const onChange = () => setReduced(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Normalized 0-1 progress of a full-height sticky track through the viewport. */
function trackProgress(track: HTMLElement): number {
  const rect = track.getBoundingClientRect();
  const scrollable = rect.height - window.innerHeight;
  return scrollable > 0 ? clamp01(-rect.top / scrollable) : 0;
}

function CinematicHero({ config, reducedMotion }: { config: CinematicSiteConfig; reducedMotion: boolean }) {
  const { hero } = config;
  const trackRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chapterRefs = useRef<Array<HTMLDivElement | null>>([]);
  const framesRef = useRef<Map<number, HTMLImageElement>>(new Map());
  const loadingRef = useRef<Set<number>>(new Set());
  const missingRef = useRef<Set<number>>(new Set());
  const currentFrameRef = useRef<number>(hero.firstFrame);
  const lastFrameRef = useRef<number>(hero.firstFrame + hero.frameCount - 1);

  useEffect(() => {
    // Reduced motion renders the static poster instead: nothing to scrub.
    if (reducedMotion) return;

    const frames = framesRef.current;
    const loading = loadingRef.current;
    const missing = missingRef.current;

    const frameUrl = (frame: number) =>
      `${hero.directory}/${hero.filePrefix}${String(frame).padStart(hero.framePadding, "0")}.${hero.fileExtension}`;

    const drawFrame = (frame: number) => {
      const canvas = canvasRef.current;
      const image = frames.get(frame);
      if (!canvas || !image || !image.complete || !image.naturalWidth) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, hero.maxDevicePixelRatio);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Cover-style fit around the configured focal point: scale up to fill,
      // then bias the overflow crop toward the subject.
      const narrow = width < hero.narrowViewportBreakpoint;
      const focal = narrow ? hero.focalPoint.narrow : hero.focalPoint.wide;
      const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(image, (width - drawWidth) * focal.x, (height - drawHeight) * focal.y, drawWidth, drawHeight);
    };

    /** Evict decoded frames furthest from the frame currently on screen. */
    const trimCache = () => {
      while (frames.size > hero.maxCachedFrames) {
        const target = currentFrameRef.current;
        let farthest = -1;
        let farthestDistance = -1;
        for (const key of frames.keys()) {
          const distance = Math.abs(key - target);
          if (distance > farthestDistance) {
            farthestDistance = distance;
            farthest = key;
          }
        }
        if (farthest < 0) return;
        frames.delete(farthest);
      }
    };

    const loadFrame = (frame: number, onLoad?: () => void) => {
      if (frames.has(frame) || loading.has(frame) || missing.has(frame)) return;
      if (loading.size >= hero.loadConcurrency) return;
      loading.add(frame);
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        loading.delete(frame);
        frames.set(frame, image);
        trimCache();
        onLoad?.();
      };
      image.onerror = () => {
        loading.delete(frame);
        missing.add(frame);
        // The sequence is shorter than the configured frameCount: clamp the
        // scrub range instead of scrubbing into frames that do not exist.
        if (frame > hero.firstFrame && frame <= lastFrameRef.current) {
          lastFrameRef.current = frame - 1;
          requestAnimationFrame(update);
        }
      };
      image.src = frameUrl(frame);
    };

    /** Highest frame that actually exists, found by probing (low exists, high unknown). */
    const probeLastFrame = (low: number, high: number) => {
      if (low >= high) {
        lastFrameRef.current = low;
        requestAnimationFrame(update);
        return;
      }
      const mid = Math.ceil((low + high) / 2);
      const probe = new Image();
      probe.onload = () => probeLastFrame(mid, high);
      probe.onerror = () => {
        missing.add(mid);
        probeLastFrame(low, mid - 1);
      };
      probe.src = frameUrl(mid);
    };

    const paintChapters = (progress: number) => {
      chapterRefs.current.forEach((element, index) => {
        const chapter = hero.chapters[index];
        if (!element || !chapter) return;
        // Crossfade in and out over the edges of the chapter's own range.
        const span = Math.max(0.001, chapter.to - chapter.from);
        const fade = Math.min(0.08, span / 3);
        // Chapters anchored to either end of the hero stay fully opaque there.
        const fadeIn = chapter.from <= 0 ? 0 : fade;
        const fadeOut = chapter.to >= 1 ? 0 : fade;
        const rising = fadeIn === 0 ? (progress >= chapter.from ? 1 : 0) : (progress - chapter.from) / fadeIn;
        const falling = fadeOut === 0 ? (progress <= chapter.to ? 1 : 0) : (chapter.to - progress) / fadeOut;
        const opacity = clamp01(Math.min(rising, falling));
        const visible = opacity > 0.05;
        element.style.opacity = String(opacity);
        element.inert = !visible;
        element.setAttribute("aria-hidden", visible ? "false" : "true");
      });
    };

    const update = () => {
      ticking = false;
      const track = trackRef.current;
      if (!track) return;
      const progress = trackProgress(track);

      const lastFrame = lastFrameRef.current;
      const targetFrame = Math.round(hero.firstFrame + progress * (lastFrame - hero.firstFrame));
      currentFrameRef.current = targetFrame;

      // Draw the closest decoded frame right away, so scrubbing never stalls.
      let nearest: number | undefined;
      if (frames.has(targetFrame)) {
        nearest = targetFrame;
      } else {
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (const key of frames.keys()) {
          const distance = Math.abs(key - targetFrame);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearest = key;
          }
        }
      }
      if (nearest !== undefined) drawFrame(nearest);

      // Bias loading slightly ahead of the playhead.
      for (const offset of [0, 1, 2, -1, 3, 4, -2]) {
        const frame = Math.min(lastFrame, Math.max(hero.firstFrame, targetFrame + offset));
        loadFrame(frame, () => {
          if (currentFrameRef.current === frame) drawFrame(frame);
        });
      }

      paintChapters(progress);
    };

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };
    const onResize = () => {
      requestAnimationFrame(() => {
        drawFrame(currentFrameRef.current);
        onScroll();
      });
    };

    // First frame first (it is also the poster), then a spread of keyframes.
    loadFrame(hero.firstFrame, () => drawFrame(hero.firstFrame));
    const configuredLast = hero.firstFrame + hero.frameCount - 1;
    const probe = new Image();
    probe.onload = () => {
      lastFrameRef.current = configuredLast;
      requestAnimationFrame(update);
    };
    probe.onerror = () => probeLastFrame(hero.firstFrame, configuredLast - 1);
    probe.src = frameUrl(configuredLast);

    for (let step = 1; step < 8; step += 1) {
      loadFrame(Math.round(hero.firstFrame + (step / 8) * (hero.frameCount - 1)));
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      frames.clear();
      loading.clear();
    };
  }, [hero, reducedMotion]);

  const chapters = hero.chapters.map((chapter, index) => (
    <div
      key={chapter.id}
      ref={(element) => {
        chapterRefs.current[index] = element;
      }}
      className="hero-chapter"
      data-align={chapter.align}
      style={reducedMotion ? undefined : { opacity: index === 0 ? 1 : 0 }}
    >
      <div className="hero-chapter__panel">
        <p className="eyebrow">{chapter.eyebrow}</p>
        {index === 0 ? <h1>{chapter.heading}</h1> : <h2>{chapter.heading}</h2>}
        <p className="muted">{chapter.body}</p>
        {(chapter.primaryCta || chapter.secondaryCta) && (
          <p className="hero-chapter__actions">
            {chapter.primaryCta && (
              <a className="btn" href={chapter.primaryCta.href}>
                {chapter.primaryCta.label}
              </a>
            )}
            {chapter.secondaryCta && (
              <a className="btn btn-secondary" href={chapter.secondaryCta.href}>
                {chapter.secondaryCta.label}
              </a>
            )}
          </p>
        )}
        {chapter.showScrollCue && !reducedMotion && (
          <p className="hero-scroll-cue" aria-hidden="true">
            Scroll to discover
          </p>
        )}
      </div>
    </div>
  ));

  if (reducedMotion) {
    return (
      <section className="hero-static" aria-label={`${siteConfig.businessName} introduction`}>
        <img className="hero-static__poster" src={hero.poster} alt="" />
        <div className="hero-static__chapters">{chapters}</div>
      </section>
    );
  }

  return (
    <section ref={trackRef} className="hero-track" style={{ height: `${hero.scrollHeightVh}vh` }} aria-label={`${siteConfig.businessName} introduction`}>
      <div className="hero-sticky">
        <canvas ref={canvasRef} className="hero-canvas" aria-hidden="true" />
        <div className="hero-scrim" aria-hidden="true" />
        {chapters}
      </div>
    </section>
  );
}

/** CSS aspect-ratio value from config's "w:h" (or already-valid) notation. */
function cssAspectRatio(value: string | undefined): string {
  if (!value) return "1 / 1";
  const [width, height] = value.split(/[:/]/).map((part) => Number(part.trim()));
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? `${width} / ${height}`
    : "1 / 1";
}

/**
 * Product images are filenames inside assets.productsDirectory — never paths.
 * Anything with a separator or traversal segment is rejected outright.
 */
function productImageUrl(productsDirectory: string, item: SiteProductItem): string | null {
  const filename = item.image?.trim();
  if (!filename) return null;
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) return null;
  return `${productsDirectory}/${filename}`;
}

function ProductsRail({ config, reducedMotion }: { config: CinematicSiteConfig; reducedMotion: boolean }) {
  const { productsSection, assets } = config;
  const trackRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const aspectRatio = useMemo(() => cssAspectRatio(productsSection.imageAspectRatio), [productsSection.imageAspectRatio]);

  useEffect(() => {
    if (reducedMotion) return;
    let ticking = false;

    const update = () => {
      ticking = false;
      const track = trackRef.current;
      const rail = railRef.current;
      if (!track || !rail) return;
      const progress = trackProgress(track);
      // Measured travel: the rail's overflow beyond the viewport, never a
      // hardcoded pixel distance.
      const travel = Math.max(0, rail.scrollWidth - window.innerWidth);
      rail.style.transform = `translate3d(${-(progress * travel).toFixed(2)}px, 0, 0)`;
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [reducedMotion]);

  const intro = (
    <div className="products-panel products-panel--intro">
      <p className="eyebrow">{productsSection.eyebrow}</p>
      <h2>{productsSection.heading}</h2>
      <p className="muted">{productsSection.body}</p>
    </div>
  );

  const cards = productsSection.items.map((item) => {
    const src = productImageUrl(assets.productsDirectory, item);
    return (
      <li className="products-panel" key={`${item.category}-${item.name}`}>
        <article className="product-card">
          <div className="product-card__media" style={{ aspectRatio }}>
            {src && <img src={src} alt={item.alt ?? item.name} loading="lazy" decoding="async" width={800} height={800} />}
          </div>
          <p className="eyebrow">{item.category}</p>
          <h3>{item.name}</h3>
          <p className="muted">{item.description}</p>
        </article>
      </li>
    );
  });

  if (reducedMotion) {
    return (
      <section id={productsSection.id} className="products-list" aria-labelledby={`${productsSection.id}-heading`}>
        <div className="products-panel products-panel--intro">
          <p className="eyebrow">{productsSection.eyebrow}</p>
          <h2 id={`${productsSection.id}-heading`}>{productsSection.heading}</h2>
          <p className="muted">{productsSection.body}</p>
        </div>
        <ul className="products-list__items">{cards}</ul>
      </section>
    );
  }

  return (
    <section
      id={productsSection.id}
      ref={trackRef}
      className="rail-track"
      style={{ height: `${productsSection.scrollHeightVh}vh` }}
      aria-label={productsSection.heading}
    >
      <div className="rail-sticky">
        <div ref={railRef} className="products-rail">
          {intro}
          <ul className="products-rail__items">{cards}</ul>
        </div>
      </div>
    </section>
  );
}

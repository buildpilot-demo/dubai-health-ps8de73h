import { useCallback, useEffect, useRef } from "react";
import { useConvex } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { siteConfig } from "../site.config";
import { convexUrl, siteId } from "../lib/convex";
import { EnquiryForm } from "./EnquiryForm";

// Submission handler on BuildPilot's shared, multi-tenant Convex deployment
// (see convex/README.md) — referenced by name, since it is defined and
// deployed outside this repository.
const submitInquiry = makeFunctionReference<"mutation">("siteSubmissions:submitInquiry");

// Shared across both the cinematic and plain site variants (see
// src/types/site-config.ts) — enquirySection, businessName, and contact all
// live on the common base of SiteConfig, so this needs no variant branch.
export function EnquirySection() {
  const { enquirySection, businessName, contact } = siteConfig;
  const sectionRef = useRef<HTMLDivElement>(null);
  const convex = useConvex();
  const connected = !!convexUrl && !!siteId && !!convex;

  const handleSubmit = useCallback(
    async (values: { name: string; email: string; phone: string; enquiryType: string; message: string }) => {
      try {
        await convex.mutation(submitInquiry, { siteId, ...values });
      } catch {
        // Never report a success the backend did not confirm.
        throw new Error(enquirySection.disconnectedMessage);
      }
    },
    [convex, enquirySection.disconnectedMessage],
  );

  useEffect(() => {
    const element = sectionRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      element?.classList.add("is-visible");
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) element.classList.add("is-visible"); },
      { threshold: 0.2 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id={enquirySection.id}
      ref={sectionRef}
      className="enquiry-section"
      aria-labelledby={`${enquirySection.id}-heading`}
    >
      <div className="enquiry-grid">
        <div className="enquiry-intro">
          <p className="eyebrow">{enquirySection.eyebrow}</p>
          <h2 id={`${enquirySection.id}-heading`}>{enquirySection.heading}</h2>
          <p className="muted">{enquirySection.body}</p>
          {contact.address && <p className="muted">{contact.address}</p>}
          {contact.hours && <p className="muted">{contact.hours}</p>}
        </div>
        <div className="enquiry-form">
          <EnquiryForm onSubmit={connected ? handleSubmit : undefined} />
        </div>
      </div>
      <footer className="site-footer">
        <div className="site-footer__grid">
          <div><strong>{businessName}</strong></div>
          <div>
            {contact.phone && <p className="muted">{contact.phone}</p>}
            {contact.email && <p className="muted"><a href={`mailto:${contact.email}`}>{contact.email}</a></p>}
          </div>
        </div>
      </footer>
    </section>
  );
}

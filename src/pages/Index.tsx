// Demo videos are hosted on Cloudflare R2 (bucket: hazgridai-media), not in the repo —
// they exceed git/Pages file-size limits. Filenames must match the bucket objects exactly.
const MEDIA_BASE = "https://pub-abc686e5fe794fc09ebce8b4d13b4960.r2.dev";
const floodSingleEventDemo = { url: `${MEDIA_BASE}/flood_single_event_demo.mp4` };
const floodStochasticDemo = { url: `${MEDIA_BASE}/flood_stochastic_demo.mp4` };
const snyderWildfireDemo = { url: `${MEDIA_BASE}/Snyder_Wilfire_Simulation.mp4` };
const fireStochasticDemo = { url: `${MEDIA_BASE}/fire_stochastic_demo.mp4` };
const palisadesFireDemo = { url: `${MEDIA_BASE}/demo01_Palisades_fire_single_scenario.mp4` };
const napaSingleDemo = { url: `${MEDIA_BASE}/demo02_Napa_fire_single_scenario.mp4` };
const napaEnsembleDemo = { url: `${MEDIA_BASE}/demo03_Napa_ensemble_run.mp4` };
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, LogOut, Waves, Wind, Flame, Target, Layers, Database, Workflow, MonitorPlay, ShieldCheck, KeyRound, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import hazgridLogo from "@/assets/hazgrid-logo.svg";
import floridaStationsMap from "@/assets/florida-stations-map.png";
import station2MaxSurgeScatter from "@/assets/station2-max-surge-scatter.png";
import station2SurgeTimeseries from "@/assets/station2-surge-timeseries.png";
import station2MaxWaterLevelScatter from "@/assets/station2-max-waterlevel-scatter.png";
import station2WaterLevelTimeseries from "@/assets/station2-waterlevel-timeseries.png";
import FloodChat from "@/components/FloodChat";

import CoastalLive from "@/components/CoastalLive";
import LiveWildfire from "@/components/LiveWildfire";
import WildfireChat from "@/components/WildfireChat";
import StationMap from "@/components/StationMap";
import FemaComparisonMap from "@/components/FemaComparisonMap";
import miamiFemaAi01 from "@/assets/miami-fema-ai-01.png";
import staugustineFemaAi01 from "@/assets/staugustine-fema-ai-01.png";
import palmbeachFemaAi01 from "@/assets/palmbeach-fema-ai-01.png";
import fortpierceFemaAi01 from "@/assets/fortpierce-fema-ai-01.png";
import capecanaveralFemaAi01 from "@/assets/capecanaveral-fema-ai-01.png";
import capecoralFemaAi01 from "@/assets/capecoral-fema-ai-01.png";
import tampaFemaAi01 from "@/assets/tampa-fema-ai-01.png";
import panamacityFemaAi01 from "@/assets/panamacity-fema-ai-01.png";
import aiSpeedComparison from "@/assets/ai-speed-comparison.png";
import palisadesValidationImg from "@/assets/Palisades_fire.png";

export type InsuranceSettings = { deductible: number; policyLimit: number };

const Index = () => {
  const { user, loading, signOut, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<string>("mission");
  // Local-dev bypass: set VITE_DISABLE_AUTH=true in .env to use all tabs (incl. Live Wildfire)
  // without logging in. Chat history just won't persist to Supabase (no user).
  const authDisabled = import.meta.env.VITE_DISABLE_AUTH === "true";
  const isGuest = !authDisabled && !user;

  const guestTabs = ["mission", "validation", "demos"];   // public tabs (no sign-in required)

  useEffect(() => {
    if (!loading && isGuest && !guestTabs.includes(activeTab)) {
      setActiveTab("mission");
    }
  }, [loading, isGuest, activeTab]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth", { replace: true });
  };

  const handleTabChange = (value: string) => {
    if (isGuest && !guestTabs.includes(value)) {
      navigate("/auth");
      return;
    }
    setActiveTab(value);
  };

  // A dropdown "tab" is active when either of its child views is active.
  const fireActive = activeTab === "live-wildfire" || activeTab === "wildfire";
  const floodActive = activeTab === "hurricane" || activeTab === "flood";
  const dropdownTriggerClass = (active: boolean) =>
    `inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm px-3 py-1.5 text-2xl font-medium ring-offset-background transition-all hover:scale-110 hover:font-bold focus-visible:outline-none data-[state=open]:font-bold ${
      active ? "bg-background text-foreground shadow-sm font-bold" : ""
    }`;

  // Hover-to-open for the FireGrid / FloodGrid menus. A short close delay bridges
  // the gap between trigger and menu so moving the pointer down doesn't dismiss it.
  const [fireOpen, setFireOpen] = useState(false);
  const [floodOpen, setFloodOpen] = useState(false);
  const fireTimer = useRef<number>();
  const floodTimer = useRef<number>();
  const openMenu = (set: (v: boolean) => void, timer: React.MutableRefObject<number | undefined>) => {
    window.clearTimeout(timer.current);
    set(true);
  };
  const closeMenuSoon = (set: (v: boolean) => void, timer: React.MutableRefObject<number | undefined>) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => set(false), 150);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <Tabs value={activeTab} onValueChange={handleTabChange} className="flex flex-1 w-full h-screen">
          {/* Active tab's sidebar + content */}
          <div className="flex flex-1 w-full h-screen">
            {/* The chat components render their own sidebar; we mount only the active one */}
            <div className={`flex flex-1 w-full flex-col ${["mission", "validation", "demos"].includes(activeTab) ? "" : "md:pl-[16rem]"}`}>
              <header className="flex-shrink-0 border-b border-border bg-card/50 backdrop-blur-sm">
                <div className="relative px-4 py-3 flex items-center gap-3">
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {!["mission", "validation", "demos"].includes(activeTab) && <SidebarTrigger className="-ml-1" />}
                    {["mission", "validation", "demos"].includes(activeTab) && (
                      <img src={hazgridLogo} alt="HazGrid ai" className="h-16 w-auto -my-2" />
                    )}
                  </div>
                   <div className="flex-1 flex justify-center min-w-0 overflow-x-auto">
                     <TabsList className="h-12">
                       <TabsTrigger value="mission" className="gap-1.5 px-3 text-2xl hover:scale-110 hover:font-bold data-[state=active]:font-bold">
                         Mission
                       </TabsTrigger>
                       <TabsTrigger value="validation" className="gap-1.5 px-3 text-2xl hover:scale-110 hover:font-bold data-[state=active]:font-bold">
                         <Target className="w-3.5 h-3.5" />
                         Validation and Efficiency
                       </TabsTrigger>
                       <TabsTrigger value="demos" className="gap-1.5 px-3 text-2xl hover:scale-110 hover:font-bold data-[state=active]:font-bold">
                         <MonitorPlay className="w-3.5 h-3.5" />
                         Demos
                       </TabsTrigger>
                        <DropdownMenu open={fireOpen} onOpenChange={setFireOpen} modal={false}>
                          <DropdownMenuTrigger
                            className={dropdownTriggerClass(fireActive)}
                            onMouseEnter={() => openMenu(setFireOpen, fireTimer)}
                            onMouseLeave={() => closeMenuSoon(setFireOpen, fireTimer)}
                          >
                            <Flame className="w-3.5 h-3.5" />
                            FireGrid
                            <ChevronDown className="w-5 h-5 opacity-70" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="center"
                            onCloseAutoFocus={(e) => e.preventDefault()}
                            onMouseEnter={() => openMenu(setFireOpen, fireTimer)}
                            onMouseLeave={() => closeMenuSoon(setFireOpen, fireTimer)}
                          >
                            <DropdownMenuItem
                              onClick={() => handleTabChange("live-wildfire")}
                              className={`text-lg ${activeTab === "live-wildfire" ? "font-semibold" : ""}`}
                            >
                              Event-Based
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleTabChange("wildfire")}
                              className={`text-lg ${activeTab === "wildfire" ? "font-semibold" : ""}`}
                            >
                              Stochastic
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>

                        <DropdownMenu open={floodOpen} onOpenChange={setFloodOpen} modal={false}>
                          <DropdownMenuTrigger
                            className={dropdownTriggerClass(floodActive)}
                            onMouseEnter={() => openMenu(setFloodOpen, floodTimer)}
                            onMouseLeave={() => closeMenuSoon(setFloodOpen, floodTimer)}
                          >
                            <Waves className="w-3.5 h-3.5" />
                            FloodGrid
                            <ChevronDown className="w-5 h-5 opacity-70" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="center"
                            onCloseAutoFocus={(e) => e.preventDefault()}
                            onMouseEnter={() => openMenu(setFloodOpen, floodTimer)}
                            onMouseLeave={() => closeMenuSoon(setFloodOpen, floodTimer)}
                          >
                            <DropdownMenuItem
                              onClick={() => handleTabChange("hurricane")}
                              className={`text-lg ${activeTab === "hurricane" ? "font-semibold" : ""}`}
                            >
                              Event-Based
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleTabChange("flood")}
                              className={`text-lg ${activeTab === "flood" ? "font-semibold" : ""}`}
                            >
                              Stochastic
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TabsList>
                   </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {isAdmin && (
                      <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}
                              title="Admin console" aria-label="Admin console">
                        <ShieldCheck className="w-4 h-4" />
                      </Button>
                    )}
                    {!isGuest && (
                      <Button variant="ghost" size="icon" onClick={() => navigate("/account")}
                              title="Your account (change password)" aria-label="Your account">
                        <KeyRound className="w-4 h-4" />
                      </Button>
                    )}
                    {isGuest ? (
                      <Button variant="ghost" size="sm" onClick={() => navigate("/auth")} className="gap-2">
                        <LogOut className="w-4 h-4" />
                        Sign in
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={handleSignOut} className="gap-2">
                        <LogOut className="w-4 h-4" />
                        Sign out
                      </Button>
                    )}
                  </div>
                </div>
              </header>

              <div className="flex flex-1 min-h-0 overflow-hidden">
                <TabsContent
                  value="mission"
                  className="flex-1 m-0 data-[state=active]:flex data-[state=inactive]:hidden overflow-auto"
                >
                  <div className="flex-1 overflow-auto">
                    <div className="max-w-6xl mx-auto px-6 py-12 md:py-16">
                      {/* Hero */}
                      <section className="text-center pb-16 mb-16 border-b border-border">
                        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-foreground mb-6">
                          Decision-Ready Hazard Intelligence<br />for Climate and Property Risk
                        </h1>
                        <p className="text-xl text-foreground leading-relaxed max-w-5xl mx-auto text-justify">
                          <strong className="font-semibold text-foreground">HazGrid AI</strong> combines geospatial
                          models, hazard data, and modern AI in an agentic workflow that quantifies
                          wildfire and flood risk from a single address to an entire portfolio. Our
                          physics-based wildfire engine reproduces real fire behavior — spread, losses, and evacuation
                          — in <strong className="font-semibold text-foreground">minutes</strong>, and our AI
                          coastal-flood model matches sophisticated numerical models at{" "}
                          <strong className="font-semibold text-foreground">135–180× the speed</strong>.
                        </p>
                        <p className="text-xl text-foreground leading-relaxed max-w-5xl mx-auto text-justify mt-4">
                          Our fully agentic workflow makes catastrophe risk modeling{" "}
                          <strong className="font-semibold text-foreground">fast</strong>,{" "}
                          <strong className="font-semibold text-foreground">easy</strong>, and{" "}
                          <strong className="font-semibold text-foreground">transparent</strong> to everyone who has to
                          make decisions about natural-hazard risk.
                        </p>
                      </section>

                      {/* Pillars */}
                      <section className="mb-16">
                        <h2 className="text-3xl font-semibold text-foreground mb-10 text-center">Capabilities</h2>
                        <div className="space-y-8 max-w-5xl mx-auto">
                          <Card className="p-8 md:p-12 h-full">
                            <h3 className="text-2xl font-semibold text-foreground mb-3">Stochastic catalogs for insurance &amp; reinsurance</h3>
                            <p className="text-lg text-foreground leading-relaxed">
                              Just ask. Our conversational AI agent turns plain-language requests into full catastrophe
                              analytics. The agent runs large stochastic event sets spanning tens of thousands of
                              simulated years of wildfire and flood, then returns the metrics you need:{" "}
                              <span className="font-medium text-foreground">average annual loss (AAL)</span>,{" "}
                              <span className="font-medium text-foreground">OEP/AEP exceedance-probability curves</span>,
                              and <span className="font-medium text-foreground">PML at key return periods</span> (e.g.
                              1-in-100, 1-in-250). Portfolio-scale analyses run through our{" "}
                              <span className="font-medium text-foreground">fmGrid financial engine</span>, giving
                              insurers and reinsurers a fast, transparent view of tail risk. The agent also analyzes
                              results to <span className="font-medium text-foreground">identify loss drivers</span> and{" "}
                              <span className="font-medium text-foreground">concentration hotspots</span>, and outputs a{" "}
                              <span className="font-medium text-foreground">comprehensive report</span> covering the
                              analysis end-to-end.
                            </p>
                          </Card>

                          <Card className="p-8 md:p-12 h-full">
                            <h3 className="text-2xl font-semibold text-foreground mb-3">FloodGrid: our flood model</h3>
                            <p className="text-lg text-foreground leading-relaxed">
                              FloodGrid simulates hurricane-induced coastal flooding with accuracy comparable to
                              sophisticated numerical models, at 135–180× the speed on the same hardware. A Florida-wide
                              domain runs in 17 seconds versus ~45 minutes for a conventional numerical solver. A full
                              10,000-year stochastic catalog completes in hours instead of months. Fast enough to run
                              portfolio-scale flood catalogs on demand, not as a months-long batch job.
                            </p>
                          </Card>

                          <Card className="p-8 md:p-12 h-full">
                            <h3 className="text-2xl font-semibold text-foreground mb-3">FireGrid: our fire model</h3>
                            <p className="text-lg text-foreground leading-relaxed">
                              Draw a fire polygon on the base map or simply name a city, and interrogate it in plain
                              language. Our physics-based FireGrid engine simulates spread under real or hypothetical
                              weather with any scenario you choose including suppression, ember spotting, structure-to-structure
                              spread, and more. It then estimates structure losses and maps evacuation access. Each
                              24-hour scenario runs in 2.5–3.5 minutes wall-clock time.
                            </p>
                            <p className="text-lg text-foreground leading-relaxed mt-4">
                              The same engine powers stochastic wildfire catalogs: thousands of simulated fire seasons
                              that produce portfolio-level loss distributions including AAL, EP curves, and PML at key
                              return periods for insurers and reinsurers pricing and managing wildfire exposure.
                            </p>
                          </Card>

                          <Card className="p-8 md:p-12 h-full">
                            <h3 className="text-2xl font-semibold text-foreground mb-3">City-scale wildfire outlook</h3>
                            <p className="text-lg text-foreground leading-relaxed">
                              Name a city and get a probabilistic outlook in minutes: up to 100 scenarios drawn from the
                              area's past-year wind climate, current-season fuel moisture, and stochastic ignition
                              patterns — automatically ranked into <span className="font-medium text-foreground">Black
                              Swan</span>, <span className="font-medium text-foreground">Severe</span>,{" "}
                              <span className="font-medium text-foreground">Expected</span>, and{" "}
                              <span className="font-medium text-foreground">Favorable</span> cases, each with modeled
                              structure losses and evacuation exposure.
                            </p>
                          </Card>

                          <Card className="p-8 md:p-12 h-full">
                            <h3 className="text-2xl font-semibold text-foreground mb-3">Flood losses &amp; portfolio financials</h3>
                            <p className="text-lg text-foreground leading-relaxed">
                              U.S. flood losses have averaged about $46 billion per year over the past decade (
                              <a
                                href="https://www.cbo.gov/publication/60803"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline hover:text-foreground"
                              >
                                ref
                              </a>
                              ). We sample return-period flood levels (2- through 500-year), combine them with
                              site-specific building characteristics, and estimate depth-driven losses — then roll
                              single-address queries up to portfolio-scale average annual loss and exceedance-probability
                              curves with our fmGrid financial engine.
                            </p>
                          </Card>
                        </div>
                        <p className="text-sm text-muted-foreground text-center mt-6">
                          Every claim above is benchmarked against numerical models and FEMA maps —{" "}
                          <button onClick={() => setActiveTab("validation")} className="underline hover:text-foreground">
                            see the Validation page
                          </button>
                          .
                        </p>
                      </section>



                      {/* Who can benefit from HazGrid ai */}
                      <section className="max-w-3xl mx-auto text-center pb-8">
                        <h2 className="text-2xl font-semibold text-foreground mb-4">Who can benefit from HazGrid ai</h2>
                        <p className="text-muted-foreground leading-relaxed">
                          HazGrid ai is designed for organizations that need interactive, faster but precise, more
                          transparent, and location-specific insight into climate and natural hazard risk. Insurers,
                          reinsurers, risk managers, lenders, real estate investors, infrastructure owners, utilities,
                          emergency planners, and government agencies can use HazGrid ai to evaluate wildfire and flood
                          exposure, estimate potential financial losses, compare risk across properties or portfolios,
                          and support better decisions around underwriting, pricing, mitigation, investment, and
                          resilience planning. By combining high-resolution geospatial data, AI-powered hazard
                          simulation, and advanced loss modeling, HazGrid ai helps stakeholders move from static risk
                          maps to actionable, property-level intelligence.
                        </p>
                      </section>

                      {/* CTA */}
                      <section className="max-w-3xl mx-auto text-center pb-16">
                        <div className="rounded-2xl border border-border bg-card p-8 md:p-10">
                          <h2 className="text-2xl font-semibold text-foreground mb-3">See it in action</h2>
                          <p className="text-muted-foreground mb-6">
                            Watch short demos of each capability, or sign in to run live simulations yourself.
                          </p>
                          <div className="flex flex-wrap items-center justify-center gap-3">
                            <Button size="lg" onClick={() => setActiveTab("demos")} className="gap-2">
                              <MonitorPlay className="w-4 h-4" />
                              Watch the demos
                            </Button>
                            {isGuest ? (
                              <Button size="lg" variant="outline" onClick={() => navigate("/auth")}>
                                Sign in for live access
                              </Button>
                            ) : (
                              <Button size="lg" variant="outline" onClick={() => setActiveTab("live-wildfire")}>
                                Open FireGrid: Event-Based
                              </Button>
                            )}
                          </div>
                        </div>
                      </section>
                    </div>
                  </div>
                </TabsContent>
                <TabsContent
                  value="validation"
                  className="flex-1 m-0 data-[state=active]:flex data-[state=inactive]:hidden overflow-auto"
                >
                  <div className="flex-1 overflow-auto">
                    <div className="max-w-6xl mx-auto px-6 py-12 md:py-16">
                      <section className="text-center mb-12">
                        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground mb-4">
                          Validation and Efficiency
                        </h1>
                        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                          How our models are benchmarked — station-level accuracy against numerical models,
                          100-year flood extents against FEMA maps, and run-time comparisons.
                        </p>
                      </section>
                      <section className="mb-16">
                        <Accordion type="multiple" defaultValue={["fire-accuracy", "accuracy", "speed"]} className="w-full">
                          <AccordionItem value="fire-accuracy" className="border rounded-lg px-6 mb-4">
                            <AccordionTrigger className="text-lg font-semibold text-foreground hover:no-underline">
                              FireGrid Model Accuracy
                            </AccordionTrigger>
                            <AccordionContent className="text-sm text-muted-foreground leading-relaxed">
                              <div className="space-y-6 pt-2">
                                <div className="space-y-4 max-w-4xl">
                                  <p className="text-base text-foreground">
                                    FireGrid is validated against the January 2025{" "}
                                    <span className="font-semibold">Palisades Fire</span>, which burned roughly
                                    23,000 acres and damaged 6,900+ structures over six days. Starting from the
                                    observed Day&nbsp;1 and Day&nbsp;2 fire states, two independent 24-hour
                                    simulations — with <span className="font-semibold">suppression and ember
                                    spotting</span> enabled — reproduce the fire's direction, shape, and coastal
                                    reach: the simulated footprint <span className="font-semibold text-red-600">(red)</span>{" "}
                                    closely tracks the six-day observed burn extent{" "}
                                    <span className="font-semibold text-amber-500">(yellow)</span>, including the
                                    wind-driven eastward run and the spread down into Pacific Palisades.
                                  </p>
                                  <p>
                                    Each 24-hour scenario completes in just{" "}
                                    <span className="font-semibold text-foreground">2.5–3.5 minutes</span>, making
                                    it practical to run many what-if scenarios per fire.
                                  </p>
                                </div>
                                <img
                                  src={palisadesValidationImg}
                                  alt="FireGrid validation against the January 2025 Palisades Fire: observed six-day extent versus 24-hour simulations with suppression and spotting"
                                  className="w-full h-auto rounded-md border border-border"
                                />
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                          <AccordionItem value="accuracy" className="border rounded-lg px-6">
                            <AccordionTrigger className="text-lg font-semibold text-foreground hover:no-underline">
                              FloodGrid: AI Coastal Flood Model Accuracy
                            </AccordionTrigger>
                            <AccordionContent className="text-sm text-muted-foreground leading-relaxed">
                              <div className="space-y-8 pt-2">
                                {/* Intro */}
                                <div className="space-y-4 max-w-4xl">
                                  <p className="text-base text-foreground">
                                    Coastal flooding during hurricanes is the result of the combined effects of{" "}
                                    <span className="font-semibold">storm surge, tide, and waves</span>. In practice,
                                    coastal water level can be viewed as the superposition of these components:
                                  </p>
                                  <ul className="space-y-3 list-none">
                                    <li className="pl-4 border-l-2 border-accent/40">
                                      <span className="font-semibold text-foreground">Storm surge</span> is the abnormal
                                      rise in water caused primarily by strong winds and low atmospheric pressure during
                                      a storm event. It is often the main driver of large-scale coastal inundation.
                                    </li>
                                    <li className="pl-4 border-l-2 border-accent/40">
                                      <span className="font-semibold text-foreground">Tide</span> is the regular
                                      astronomical variation in sea level. It raises or lowers the background water level with non-linear interaction with other components, meaning the same
                                      storm may produce more or less severe flooding depending on tide levels.
                                    </li>
                                    <li className="pl-4 border-l-2 border-accent/40">
                                      <span className="font-semibold text-foreground">Waves</span> contribute additional
                                      coastal hazard through wave setup, runup, and localized overtopping, especially
                                      along exposed shorelines. Under hurricane conditions, waves can significantly
                                      worsen total flooding impacts and structural damages.
                                    </li>
                                  </ul>
                                  <p className="text-base text-foreground pt-2">
                                    To evaluate model accuracy and precision, first we compare the AI model against the
                                    numerical model at coastal stations across Florida. Then we compare the AI 100-year
                                    flood extend against FEMA 100-year map.
                                  </p>
                                </div>

                                {/* Divider */}
                                <div className="border-t border-border" />

                                <p className="text-base text-foreground leading-relaxed">
                                  <span className="font-semibold">AI model accuracy vs Numerical model:</span> Here the
                                  flood levels (surge and water levels) at 7 coastal stations are compared across
                                  Florida coastline. The comparison is made on test (or held-out) set. Note that the
                                  upper panels when you hover on the stations shows surge comparison and the lower
                                  panels compare the water levels (surge + tide).
                                </p>

                                {/*Florida station map (interactive) */}
                                <StationMap />

                                {/* Divider */}
                                <div className="border-t border-border" />

                                <p className="text-base text-foreground leading-relaxed">
                                  <span className="font-semibold">AI model flood extent vs FEMA map:</span> Here the
                                  100-year flood extends are shown for FEMA (green raster) and our AI coastal flood
                                  model (red dots). We also show sample flood levels (total water level (TWL) = surge +
                                  tide + wave) to validate the 100-year water levels. Note: FEMA flood map includes both
                                  coastal and inland flood.
                                </p>
                                <p className="text-base text-foreground leading-relaxed">
                                  Hover on the asterisks to see the point-wise comparison.
                                </p>

                                <div className="flex flex-wrap gap-6 justify-start">
                                  <FemaComparisonMap
                                    imageSrc={miamiFemaAi01}
                                    alt="Miami 100-year flood extent: FEMA (green) vs AI model (red dots) with validation points."
                                    title="Miami"
                                    points={[
                                      {
                                        id: "p1",
                                        name: "Point 1",
                                        x: 63.8,
                                        y: 15.7,
                                        lon: -80.1871875,
                                        lat: 25.80625,
                                        aiTwl: 3.35,
                                        femaTwl: 3.02,
                                      },
                                      {
                                        id: "p2",
                                        name: "Point 2",
                                        x: 19.0,
                                        y: 67.1,
                                        lon: -80.265234375,
                                        lat: 25.693515625,
                                        aiTwl: 2.86,
                                        femaTwl: 3.02,
                                      },
                                    ]}
                                  />
                                  <FemaComparisonMap
                                    imageSrc={staugustineFemaAi01}
                                    alt="St. Augustine 100-year flood extent: FEMA (green) vs AI model (red dots) with validation points."
                                    title="St. Augustine"
                                    points={[
                                      {
                                        id: "p1",
                                        name: "Point 1",
                                        x: 67.0,
                                        y: 64.94,
                                        lon: -81.285625,
                                        lat: 29.899375,
                                        aiTwl: 2.42,
                                        femaTwl: 2.13,
                                      },
                                      {
                                        id: "p2",
                                        name: "Point 2",
                                        x: 47.53,
                                        y: 25.78,
                                        lon: -81.300078125,
                                        lat: 29.925390625,
                                        aiTwl: 2.6,
                                        femaTwl: 2.74,
                                      },
                                      {
                                        id: "p3",
                                        name: "Point 3",
                                        x: 35.78,
                                        y: 77.23,
                                        lon: -81.30875,
                                        lat: 29.890703125,
                                        aiTwl: 3.19,
                                        femaTwl: 3.05,
                                      },
                                      {
                                        id: "p4",
                                        name: "Point 4",
                                        x: 20.4,
                                        y: 17.84,
                                        lon: -81.3203125,
                                        lat: 29.931171875,
                                        aiTwl: 2.78,
                                        femaTwl: 2.74,
                                      },
                                    ]}
                                  />
                                  <FemaComparisonMap
                                    imageSrc={palmbeachFemaAi01}
                                    alt="Palm Beach 100-year flood extent: FEMA (green) vs AI model (red dots) with validation points."
                                    title="Palm Beach"
                                    points={[
                                      {
                                        id: "p1",
                                        name: "Point 1",
                                        x: 48.07,
                                        y: 31.17,
                                        lon: -80.045546875,
                                        lat: 26.618515625,
                                        aiTwl: 3.02,
                                        femaTwl: 3.05,
                                      },
                                    ]}
                                  />
                                  <FemaComparisonMap
                                    imageSrc={fortpierceFemaAi01}
                                    alt="Fort Pierce 100-year flood extent: FEMA (green) vs AI model (red dots) with validation points."
                                    title="Fort Pierce"
                                    points={[
                                      {
                                        id: "p1",
                                        name: "Point 1",
                                        x: 52.56,
                                        y: 36.8,
                                        lon: -80.294140625,
                                        lat: 27.462578125,
                                        aiTwl: 1.97,
                                        femaTwl: 1.52,
                                      },
                                    ]}
                                  />
                                  <FemaComparisonMap
                                    imageSrc={capecanaveralFemaAi01}
                                    alt="Cape Canaveral 100-year flood extent: FEMA (green) vs AI model (red dots) with validation points."
                                    title="Cape Canaveral"
                                    points={[
                                      {
                                        id: "p1",
                                        name: "Point 1",
                                        x: 48.12,
                                        y: 3.51,
                                        lon: -80.57453125,
                                        lat: 28.535,
                                        aiTwl: 2.43,
                                        femaTwl: 2.44,
                                      },
                                      {
                                        id: "p2",
                                        name: "Point 2",
                                        x: 32.71,
                                        y: 96.82,
                                        lon: -80.591875,
                                        lat: 28.410703125,
                                        aiTwl: 2.81,
                                        femaTwl: 3.05,
                                      },
                                    ]}
                                  />
                                  <FemaComparisonMap
                                    imageSrc={capecoralFemaAi01}
                                    alt="Cape Coral 100-year flood extent: FEMA (green) vs AI model (red dots) with validation points."
                                    title="Cape Coral"
                                    points={[
                                      {
                                        id: "p1",
                                        name: "Point 1",
                                        x: 57.17,
                                        y: 97.54,
                                        lon: -81.96203125,
                                        lat: 26.5,
                                        aiTwl: 3.02,
                                        femaTwl: 3.05,
                                      },
                                      {
                                        id: "p2",
                                        name: "Point 2",
                                        x: 78.04,
                                        y: 9.76,
                                        lon: -81.901328125,
                                        lat: 26.6734375,
                                        aiTwl: 2.98,
                                        femaTwl: 3.05,
                                      },
                                      {
                                        id: "p3",
                                        name: "Point 3",
                                        x: 13.51,
                                        y: 9.75,
                                        lon: -82.08921875,
                                        lat: 26.676328125,
                                        aiTwl: 3.3,
                                        femaTwl: 3.05,
                                      },
                                    ]}
                                  />
                                  <FemaComparisonMap
                                    imageSrc={panamacityFemaAi01}
                                    alt="Panama City 100-year flood extent: FEMA (green) vs AI model (red dots) with validation points."
                                    title="Panama City"
                                    points={[
                                      {
                                        id: "p1",
                                        name: "Point 1",
                                        x: 92.87,
                                        y: 88.65,
                                        lon: -85.583984375,
                                        lat: 30.1190625,
                                        aiTwl: 2.34,
                                        femaTwl: 2.74,
                                      },
                                      {
                                        id: "p2",
                                        name: "Point 2",
                                        x: 52.53,
                                        y: 18.97,
                                        lon: -85.676484375,
                                        lat: 30.27515625,
                                        aiTwl: 3.45,
                                        femaTwl: 3.35,
                                      },
                                    ]}
                                  />
                                  <FemaComparisonMap
                                    imageSrc={tampaFemaAi01}
                                    alt="Tampa 100-year flood extent: FEMA (green) vs AI model (red dots) with validation points."
                                    title="Tampa"
                                    points={[
                                      {
                                        id: "p1",
                                        name: "Point 1",
                                        x: 57.67,
                                        y: 32.47,
                                        lon: -82.519921875,
                                        lat: 27.890390625,
                                        aiTwl: 2.93,
                                        femaTwl: 3.05,
                                      },
                                      {
                                        id: "p2",
                                        name: "Point 2",
                                        x: 94.55,
                                        y: 28.56,
                                        lon: -82.398515625,
                                        lat: 27.90484375,
                                        aiTwl: 3.72,
                                        femaTwl: 3.96,
                                      },
                                    ]}
                                  />
                                </div>
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                          <AccordionItem value="speed" className="border rounded-lg px-6 mt-4">
                            <AccordionTrigger className="text-lg font-semibold text-foreground hover:no-underline">
                              AI Coastal Flood Model Run-time Speed
                            </AccordionTrigger>
                            <AccordionContent className="text-sm text-muted-foreground leading-relaxed">
                              <div className="space-y-6 pt-2">
                                <p className="text-base text-foreground leading-relaxed">
                                  The computational time of coastal flood simulation for one single hurricane and for
                                  the entire State of Florida using <span className="font-semibold">4 CPUs</span>{" "}
                                  reveals the major advantage of AI simulation. A traditional numerical simulation may
                                  take up to <span className="font-semibold">45 minutes</span> per hurricane, while the
                                  AI model produces simulation outputs in only{" "}
                                  <span className="font-semibold">15–20 seconds</span>, making the AI model
                                  approximately <span className="font-semibold">135×–180× faster</span> for each storm.
                                  At the scale of a{" "}
                                  <span className="font-semibold">10,000-year stochastic catalog</span> with more than{" "}
                                  <span className="font-semibold">12,000 hurricanes</span>, the difference becomes
                                  substantial: running all storms numerically would require about
                                  <span className="font-semibold"> 540,000 minutes</span>, or{" "}
                                  <span className="font-semibold">9,000 hours</span>, which is approximately
                                  <span className="font-semibold"> 375 days</span>. In comparison, the AI model would
                                  require only about
                                  <span className="font-semibold"> 180,000–240,000 seconds</span>, equal to{" "}
                                  <span className="font-semibold">3,000–4,000 minutes</span>, or roughly{" "}
                                  <span className="font-semibold">50–67 hours</span> using the same resources. With
                                  ideal parallelization on <span className="font-semibold">100 CPUs</span>, assuming
                                  each simulation uses 4 CPUs and therefore about 25 storms can run at the same time,
                                  the numerical model runtime would still be about
                                  <span className="font-semibold"> 21,600 minutes</span>, or{" "}
                                  <span className="font-semibold">360 hours</span>, which is approximately
                                  <span className="font-semibold"> 15 days</span>. Under the same parallel setup, the AI
                                  model would complete the full catalog in only about{" "}
                                  <span className="font-semibold">120–160 minutes</span>, or roughly{" "}
                                  <span className="font-semibold">2.0–2.7 hours</span>. This speed advantage makes the
                                  AI model practical for large-scale stochastic hurricane catalogs, rapid scenario
                                  screening, and portfolio-level coastal flood risk analysis across the State of
                                  Florida. We have a clear plan to reduce the AI computational time to under{" "}
                                  <span className="font-semibold">1 sec</span> per storm using 4 CPUs.
                                </p>
                                <p className="text-base text-foreground leading-relaxed">
                                  Note that, compared to our AI model, numerical models require much larger RAMs to
                                  upload simulation artifacts. Also, numerical computational time increases significantly
                                  under the following scenarios due to Courant number restriction: 1) strong hurricanes,
                                  2) refined mesh to resolve narrow channels or waterways. The AI model is independent
                                  of Courant number and, for both scenarios, the AI model computational time remains
                                  intact.
                                </p>
                                <img
                                  src={aiSpeedComparison}
                                  alt="AI Risk Model Speed Comparison: AI model vs numerical model runtime for Florida coastal flood simulation."
                                  className="w-4/5 h-auto mx-auto rounded-lg border border-border"
                                />
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        </Accordion>
                      </section>
                    </div>
                  </div>
                </TabsContent>
                <TabsContent
                  value="demos"
                  className="flex-1 m-0 data-[state=active]:flex data-[state=inactive]:hidden overflow-auto"
                >
                  <div className="flex-1 overflow-auto">
                    <div className="max-w-6xl mx-auto px-6 py-12 md:py-16">
                      <section className="text-center mb-12">
                        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground mb-4">
                          Product Demos
                        </h1>
                        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                          Short recordings of each HazGrid ai capability in action — event simulation,
                          stochastic risk, and live scenario analysis.
                        </p>
                      </section>
                      <section className="grid md:grid-cols-2 gap-8 pb-8">
                        {[
                          {
                            title: "FireGrid: Palisades Fire",
                            caption:
                              "From fire simulation to loss estimation and evacuation planning.",
                            src: palisadesFireDemo.url,
                          },
                          {
                            title: "FireGrid: Napa Single Scenario",
                            caption:
                              "From fire simulation to loss estimation and evacuation planning.",
                            src: napaSingleDemo.url,
                          },
                          {
                            title: "FireGrid: Ensemble simulation of fire in Napa, CA",
                            caption:
                              "Probabilistic multi-scenario outlook with ranked Black Swan / Severe / Expected / Favorable picks and losses.",
                            src: napaEnsembleDemo.url,
                          },
                          {
                            title: "FloodGrid: Event-Based",
                            caption:
                              "Hurricane-driven surge and inundation for a single event, computed by the AI model in seconds.",
                            src: floodSingleEventDemo.url,
                          },
                          {
                            title: "FloodGrid: Stochastic",
                            caption:
                              "Stochastic coastal flood risk — thousands of synthetic events aggregated into probabilistic hazard.",
                            src: floodStochasticDemo.url,
                          },
                          {
                            title: "FireGrid: Stochastic",
                            caption:
                              "Stochastic wildfire modeling — burn probability surfaces from large ensembles of simulated fires.",
                            src: fireStochasticDemo.url,
                          },
                          {
                            title: "Snyder Wildfire Event Simulation",
                            caption:
                              "Event-based wildfire simulation of the Snyder fire with terrain- and wind-driven spread.",
                            src: snyderWildfireDemo.url,
                          },
                        ].map((d) => (
                          <div key={d.title} className="rounded-lg border border-border bg-card p-4">
                            <h3 className="text-lg font-semibold text-foreground mb-1">{d.title}</h3>
                            <p className="text-sm text-muted-foreground mb-3">{d.caption}</p>
                            <video src={d.src} controls preload="metadata" className="w-full h-auto rounded-md border border-border" />
                          </div>
                        ))}
                      </section>
                    </div>
                  </div>
                </TabsContent>
                 <TabsContent
                   value="hurricane"
                   className="flex-1 m-0 data-[state=active]:flex data-[state=inactive]:hidden"
                 >
                   <CoastalLive />
                 </TabsContent>
                 <TabsContent value="flood" className="flex-1 m-0 data-[state=active]:flex data-[state=inactive]:hidden">
                   <FloodChat />
                 </TabsContent>
                  <TabsContent
                    value="wildfire"
                    className="flex-1 m-0 data-[state=active]:flex data-[state=inactive]:hidden"
                  >
                    <WildfireChat />
                  </TabsContent>
                  <TabsContent
                    value="live-wildfire"
                    forceMount
                    className="flex-1 m-0 data-[state=active]:flex data-[state=inactive]:hidden overflow-auto"
                  >
                    <LiveWildfire />
                  </TabsContent>
              </div>
            </div>
          </div>
        </Tabs>
      </div>
    </SidebarProvider>
  );
};

export default Index;

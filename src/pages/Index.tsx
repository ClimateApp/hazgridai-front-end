import floodSingleEventDemo from "@/assets/flood_single_event_demo.mp4.asset.json";
import floodStochasticDemo from "@/assets/flood_stochastic_demo.mp4.asset.json";
import palisadesWildfireDemo from "@/assets/Palisades_Wilfire_Simulation.mp4.asset.json";
import snyderWildfireDemo from "@/assets/Snyder_Wilfire_Simulation.mp4.asset.json";
import fireStochasticDemo from "@/assets/fire_stochastic_demo.mp4.asset.json";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, LogOut, Waves, Wind, Flame, Target, Layers, Database, Workflow, ChevronDown } from "lucide-react";
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

import HurricaneChat from "@/components/HurricaneChat";
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

export type InsuranceSettings = { deductible: number; policyLimit: number };

const Index = () => {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<string>("mission");
  // Local-dev bypass: set VITE_DISABLE_AUTH=true in .env to use all tabs (incl. Live Wildfire)
  // without logging in. Chat history just won't persist to Supabase (no user).
  const authDisabled = import.meta.env.VITE_DISABLE_AUTH === "true";
  const isGuest = !authDisabled && !user;

  useEffect(() => {
    if (!loading && isGuest && activeTab !== "mission") {
      setActiveTab("mission");
    }
  }, [loading, isGuest, activeTab]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth", { replace: true });
  };

  const handleTabChange = (value: string) => {
    if (isGuest && value !== "mission") {
      navigate("/auth");
      return;
    }
    setActiveTab(value);
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
            <div className={`flex flex-1 w-full flex-col ${activeTab === "mission" ? "" : "md:pl-[16rem]"}`}>
              <header className="flex-shrink-0 border-b border-border bg-card/50 backdrop-blur-sm">
                <div className="relative px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {activeTab !== "mission" && <SidebarTrigger className="-ml-1" />}
                    {activeTab === "mission" && (
                      <img src={hazgridLogo} alt="HazGrid ai" className="h-16 w-auto -my-2" />
                    )}
                  </div>
                   <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                     <TabsList>
                       <TabsTrigger value="mission" className="gap-1.5">
                         Mission
                       </TabsTrigger>
                        <TabsTrigger value="hurricane" className="gap-1.5">
                          <Wind className="w-4 h-4" />
                          Coastal Flood AI Model
                        </TabsTrigger>
                        <TabsTrigger value="flood" className="gap-1.5">
                          <Waves className="w-4 h-4" />
                          Flood Risk
                        </TabsTrigger>
                          <TabsTrigger value="wildfire" className="gap-1.5">
                            <Flame className="w-4 h-4" />
                            Wildfire Event Simulation
                          </TabsTrigger>
                         <TabsTrigger value="live-wildfire" className="gap-1.5">
                           <Flame className="w-4 h-4" />
                           Live Wildfire
                         </TabsTrigger>
                      </TabsList>
                   </div>
                  <div className="flex items-center gap-3">
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
                      <section className="text-center mb-16">
                        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-foreground mb-6">
                          AI framework for decision-ready hazard intelligence for climate and property risk
                        </h1>
                        <p className="text-lg text-muted-foreground leading-relaxed max-w-3xl mx-auto">
                          <strong className="font-semibold text-foreground">HazGrid ai</strong> combines geospatial
                          models, regulatory-grade hazard data, and modern AI within an{" "}
                          <strong className="font-semibold text-foreground">agentic workflow</strong>, enabling
                          stakeholders to quantify flood, wind and wildfire loss potential at specific locations. It
                          also supports hurricane-driven coastal flood simulations using a{" "}
                          <strong className="font-semibold text-foreground">cutting-edge AI model</strong> that delivers
                          accuracy comparable to sophisticated numerical models while running at least 130×-180x faster.
                        </p>
                      </section>

                      {/* Pillars */}
                      <section className="mb-16">
                        <h2 className="text-2xl font-semibold text-foreground mb-8 text-center">Capability Pillars</h2>
                        <div className="grid md:grid-cols-3 gap-6">
                          <Card className="p-6">
                            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-accent to-primary flex items-center justify-center mb-4">
                              <Waves className="w-5 h-5 text-primary-foreground" />
                            </div>
                            <h3 className="text-lg font-semibold text-foreground mb-2">
                              Coastal flood AI model: event-based exposure
                            </h3>
                            <p className="text-sm text-muted-foreground leading-relaxed">
                              We developed an AI model with cutting edge technology that simulates hurricane-induced
                              coastal flood with accuracy comparable to the sophisticated numerical models but 130x-180x
                              faster. With the current setup and for the entire State of Florida, each hurricane is
                              simulated within 15-20 sec using 4 CPUs. For the same geographic extent and using 100
                              CPUs, the AI model can simulate a 10,000-year stochastic catalog within 2-2.7 hours. We
                              have a clear path to optimize the computational time per hurricane to under 1 sec.
                            </p>
                          </Card>

                          <Card className="p-6">
                            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-accent to-primary flex items-center justify-center mb-4">
                              <Waves className="w-5 h-5 text-primary-foreground" />
                            </div>
                            <h3 className="text-lg font-semibold text-foreground mb-2">
                              Coastal flood damage: return-period exposure
                            </h3>

                            <p className="text-sm text-muted-foreground leading-relaxed">
                              Flooding causes significant financial damage across the U.S. every year, with recent
                              estimates showing average annual flood losses of about $46 billion over the past decade (
                              <a
                                href="https://www.cbo.gov/publication/60803"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline hover:text-foreground"
                              >
                                ref
                              </a>
                              ).
                            </p>
                            <p className="text-sm text-muted-foreground leading-relaxed">
                              We sample return-period flood levels (e.g., 2- through 500-year horizons), combine them
                              with site-specific building factors , and estimate flood depth to calculate groundup and
                              gross losses. Delivered as single-point queries and CSV batch enrichment for losses.
                            </p>
                          </Card>

                          <Card className="p-6">
                            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-accent to-primary flex items-center justify-center mb-4">
                              <Flame className="w-5 h-5 text-primary-foreground" />
                            </div>
                            <h3 className="text-lg font-semibold text-foreground mb-2">Wildfire financial risk</h3>
                            <p className="text-sm text-muted-foreground leading-relaxed">
                              Wildfires impose a major financial burden on the U.S. every year, with NIST estimating the
                              annualized economic burden of wildfire at $71.1 billion to $347.8 billion in 2016 dollars
                              (
                              <a
                                href="https://www.nist.gov/publications/costs-and-losses-wildfires"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline hover:text-foreground"
                              >
                                ref
                              </a>
                              ).
                            </p>
                            <p className="text-sm text-muted-foreground leading-relaxed">
                              We translate annual burn probability, risk to structures, and structure replacement value
                              into Expected Annual Loss (EAL) and multi-horizon structural groundup loss estimates
                              (e.g., 2- through 100-year windows), for points or full CSV uploads. We have plans to add
                              gross losses to wildfire.
                            </p>
                          </Card>
                        </div>
                      </section>

                      {/* AI Risk Model Accuracy */}
                      <section className="mb-16">
                        <Accordion type="single" collapsible className="w-full">
                          <AccordionItem value="accuracy" className="border rounded-lg px-6">
                            <AccordionTrigger className="text-lg font-semibold text-foreground hover:no-underline">
                              AI Coastal Flood Model Accuracy
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
                                      astronomical variation in sea level. It raises or lowers the background water
                                      water level with non-linear interaction with other components, meaning the same
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
                                  <span className="font-semibold">AI model flood extend vs FEMA map:</span> Here the
                                  100-year flood extends are shown for FEMA (green raster) and our AI coastal flood
                                  model (red dots). We also shown sample flood levels (total water level (TWL) = surge +
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
                                  Note that, compare to our AI model, numerical models require much larger RAMs to
                                  upload simulation artifacts. Also, numerical computaional time increases significantly
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
                          <AccordionItem value="demo" className="border rounded-lg px-6 mt-4">
                            <AccordionTrigger className="text-lg font-semibold text-foreground hover:no-underline">
                              Demo
                            </AccordionTrigger>
                            <AccordionContent className="text-sm text-muted-foreground leading-relaxed">
                              <div className="space-y-6 pt-2">
                                <p className="text-base text-foreground text-center font-medium flex items-center justify-center gap-2">
                                  Demos for flood and wildfire calculation
                                  <ChevronDown className="w-5 h-5" />
                                </p>
                                <div className="mt-8 w-4/5 mx-auto">
                                  <h4 className="text-lg font-semibold text-foreground mb-3 text-center">
                                    Coastal Flood AI Model
                                  </h4>
                                  <video
                                    src={floodSingleEventDemo.url}
                                    controls
                                    className="w-full h-auto rounded-lg border border-border"
                                  />
                                </div>
                                <div className="mt-8 w-4/5 mx-auto">
                                  <h4 className="text-lg font-semibold text-foreground mb-3 text-center">
                                    Flood Risk
                                  </h4>
                                  <video
                                    src={floodStochasticDemo.url}
                                    controls
                                    className="w-full h-auto rounded-lg border border-border"
                                  />
                                </div>
                                <div className="mt-8 w-4/5 mx-auto">
                                  <h4 className="text-lg font-semibold text-foreground mb-3 text-center">
                                    Palisades Wildfire Event Simulation
                                  </h4>
                                  <video
                                    src={palisadesWildfireDemo.url}
                                    controls
                                    className="w-full h-auto rounded-lg border border-border"
                                  />
                                </div>
                                <div className="mt-8 w-4/5 mx-auto">
                                  <h4 className="text-lg font-semibold text-foreground mb-3 text-center">
                                    Wildfire Risk
                                  </h4>
                                  <video
                                    src={fireStochasticDemo.url}
                                    controls
                                    className="w-full h-auto rounded-lg border border-border"
                                  />
                                </div>
                                <div className="mt-8 w-4/5 mx-auto">
                                  <h4 className="text-lg font-semibold text-foreground mb-3 text-center">
                                    Snyder Wildfire Event Simulation
                                  </h4>
                                  <video
                                    src={snyderWildfireDemo.url}
                                    controls
                                    className="w-full h-auto rounded-lg border border-border"
                                  />
                                </div>
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        </Accordion>
                      </section>

                      {/* What next */}
                      <section className="mb-16 max-w-5xl mx-auto">
                        <h2 className="text-2xl font-semibold text-foreground mb-8 text-center">What next</h2>
                        <div className="grid md:grid-cols-2 gap-6">
                          <Card className="p-6">
                            <h3 className="text-lg font-semibold text-foreground mb-2">
                              Expand coastal flood coverage
                            </h3>
                            <p className="text-sm text-muted-foreground leading-relaxed">
                              Extend the AI coastal flood model from Florida to the full U.S. East Coast and Gulf Coast,
                              bringing event-based surge and inundation simulation to a broader set of coastal
                              communities.
                            </p>
                          </Card>

                          <Card className="p-6">
                            <h3 className="text-lg font-semibold text-foreground mb-2">Inland flood workflow</h3>
                            <p className="text-sm text-muted-foreground leading-relaxed">
                              Develop an AI-powered inland flood pipeline that simulates and assesses rainfall-driven
                              and riverine flooding, closing the gap between coastal and inland peril coverage.
                            </p>
                          </Card>

                          <Card className="p-6">
                            <h3 className="text-lg font-semibold text-foreground mb-2">Wildfire AI model</h3>
                            <p className="text-sm text-muted-foreground leading-relaxed">
                              Build a wildfire AI model beginning with California, then expand toward nationwide U.S.
                              coverage to deliver high-resolution burn probability and fire behavior predictions.
                            </p>
                          </Card>

                          <Card className="p-6">
                            <h3 className="text-lg font-semibold text-foreground mb-2">
                              High-resolution loss modeling
                            </h3>
                            <p className="text-sm text-muted-foreground leading-relaxed">
                              Integrate a sophisticated loss engine that supports complex insurance policy structures
                              and estimates losses at a 10-meter grid resolution for granular, portfolio-grade risk
                              quantification.
                            </p>
                          </Card>
                        </div>
                      </section>

                      {/* Who can benefit from HazGrid ai */}
                      <section className="max-w-3xl mx-auto text-center pb-8">
                        <h2 className="text-2xl font-semibold text-foreground mb-4">Who can benefit from HazGrid ai</h2>
                        <p className="text-muted-foreground leading-relaxed">
                          HazGrid ai is designed for organizations that need interactive, faster but precise, more
                          transparent, and location-specific insight into climate and natural hazard risk. Insurers,
                          reinsurers, risk managers, lenders, real estate investors, infrastructure owners, utilities,
                          emergency planners, and government agencies can use HazGrid ai to evaluate flood and wildfire
                          exposure, estimate potential financial losses, compare risk across properties or portfolios,
                          and support better decisions around underwriting, pricing, mitigation, investment, and
                          resilience planning. By combining high-resolution geospatial data, AI-powered hazard
                          simulation, and advanced loss modeling, HazGrid ai helps stakeholders move from static risk
                          maps to actionable, property-level intelligence.
                        </p>
                      </section>
                    </div>
                  </div>
                </TabsContent>
                 <TabsContent
                   value="hurricane"
                   className="flex-1 m-0 data-[state=active]:flex data-[state=inactive]:hidden"
                 >
                   <HurricaneChat />
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

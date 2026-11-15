import { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Database,
  HelpCircle,
  Languages,
  Loader2,
  MapPin,
  MessageSquare,
  Send,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import type {
  AiAssistantResponse,
  AiChatTurn,
  AssistantLanguage,
  ClimateTrendSummary,
  CropGrowingSeason,
  EcostressResultPayload,
  FarmingSystemMode,
  HlsResultPayload,
  LabSoilTestResult,
  Phase4EnvironmentalAnalytics,
  Phase5FarmIntelligence,
  SoilMoistureSnapshot,
  SoilProfile,
  WeatherTelemetrySnapshot,
} from '../../../shared/index.ts';
import { useSelectedFarmGeometry } from '../../context/FarmWorkspaceContext.tsx';
import { apiClient, ApiClientError } from '../../services/apiClient.ts';
import {
  extractLatestEcostressView,
  extractLatestHlsView,
  formatShortDate,
} from '../environmental/environmentalUtils.ts';

interface AiAssistantViewProps {
  weatherTelemetry: WeatherTelemetrySnapshot | null;
  climateTrends: ClimateTrendSummary | null;
  soilProfile: SoilProfile | null;
  soilMoisture: SoilMoistureSnapshot | null;
  ecostressResult?: EcostressResultPayload | null;
  hlsResult?: HlsResultPayload | null;
  environmentalAnalytics?: Phase4EnvironmentalAnalytics | null;
  farmIntelligence?: Phase5FarmIntelligence | null;
  onReturnToMap: () => void;
}

interface ChatMessageEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  language: AssistantLanguage;
  response?: AiAssistantResponse;
}

const LAB_STORAGE_KEY = 'fieldshift-lab-soil-tests-v1';

const SUGGESTED_QUESTIONS: Array<{ en: string; hi: string }> = [
  {
    en: 'What does the latest vegetation observation indicate?',
    hi: 'नवीनतम वनस्पति (NDVI/NDWI) अवलोकन क्या संकेत देता है?',
  },
  {
    en: 'Is there evidence of evaporative stress?',
    hi: 'क्या वाष्पीकरण तनाव (Evaporative Stress) के प्रमाण हैं?',
  },
  {
    en: 'How do soil moisture and ET observations compare?',
    hi: 'मिट्टी की नमी (SMAP) और वाष्पोत्सर्जन (ET) के अवलोकन की तुलना कैसे है?',
  },
  {
    en: 'What environmental evidence supports the recommended crop?',
    hi: 'सुझाई गई फसल के पक्ष में कौन से पर्यावरणीय प्रमाण हैं?',
  },
  {
    en: 'Which crops are suitable for my farm?',
    hi: 'मेरे खेत के लिए कौन-सी फसलें उपयुक्त हैं?',
  },
  {
    en: 'Why was this crop recommended?',
    hi: 'यह फसल क्यों सुझाई गई?',
  },
  {
    en: 'What are the soil limitations?',
    hi: 'मेरी मिट्टी की सीमाएं क्या हैं?',
  },
  {
    en: 'How can I conserve water?',
    hi: 'मैं पानी की बचत कैसे कर सकता हूँ?',
  },
  {
    en: 'Which crop rotation is better?',
    hi: 'कौन-सा फसल चक्र बेहतर है?',
  },
  {
    en: 'What environmental risks should I consider?',
    hi: 'मुझे किन पर्यावरणीय जोखिमों पर ध्यान देना चाहिए?',
  },
  {
    en: 'How do recent weather conditions affect my planting decision?',
    hi: 'हाल का मौसम मेरी बुवाई के निर्णय को कैसे प्रभावित करता है?',
  },
  {
    en: 'What do the 7–14 day satellite trend projections and confidence levels show?',
    hi: '7–14 दिन के सैटेलाइट ट्रेंड अनुमान और डेटा विश्वसनीयता (Confidence) क्या दिखाते हैं?',
  },
  {
    en: 'What verification steps should I take on my farm based on today’s alerts?',
    hi: 'आज के अलर्ट के आधार पर मुझे अपने खेत में कौन-सी जांच या कदम उठाने चाहिए?',
  },
];

function loadSavedLabTestForParcel(parcelKey: string): LabSoilTestResult | null {
  try {
    const raw = window.localStorage.getItem(LAB_STORAGE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, LabSoilTestResult>;
    return map[parcelKey] ?? null;
  } catch {
    return null;
  }
}

export function AiAssistantView({
  weatherTelemetry,
  climateTrends,
  soilProfile,
  soilMoisture,
  ecostressResult = null,
  hlsResult = null,
  environmentalAnalytics = null,
  farmIntelligence = null,
  onReturnToMap,
}: AiAssistantViewProps) {
  const { activeCoordinates, selectedBoundary, selectedBoundaryPayload, markerLabel } =
    useSelectedFarmGeometry();
  const parcelKey = selectedBoundary ? `boundary:${selectedBoundary.id}` : 'marker:default';
  const parcelLabel = selectedBoundary
    ? `${selectedBoundary.name} (${selectedBoundary.areaHectares.toFixed(2)} ha)`
    : markerLabel;
  const activeLabTest = useMemo(() => loadSavedLabTestForParcel(parcelKey), [parcelKey]);
  const latestEcoView = useMemo(
    () => extractLatestEcostressView(ecostressResult),
    [ecostressResult],
  );
  const latestHlsView = useMemo(() => extractLatestHlsView(hlsResult), [hlsResult]);

  const [language, setLanguage] = useState<AssistantLanguage>('en');
  const [growingSeason, setGrowingSeason] = useState<CropGrowingSeason>('Kharif');
  const [farmingSystem, setFarmingSystem] = useState<FarmingSystemMode>('rainfed');
  const [currentCrop, setCurrentCrop] = useState<string>('Soybean');
  const [autoFetchContext, setAutoFetchContext] = useState<boolean>(true);
  const [promptInput, setPromptInput] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessageEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const lastAssistantResponse = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].response) {
        return messages[i].response!;
      }
    }
    return null;
  }, [messages]);

  async function submitQuestion(rawQuestion: string) {
    const trimmed = rawQuestion.trim();
    if (trimmed.length < 3 || loading) return;

    const userEntry: ChatMessageEntry = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: trimmed,
      language,
    };

    const historyPayload: AiChatTurn[] = messages.slice(-6).map((m) => ({
      role: m.role,
      content: m.text,
    }));

    setMessages((prev) => [...prev, userEntry]);
    setPromptInput('');
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.askAssistant({
        prompt: trimmed,
        language,
        location: activeCoordinates,
        currentCrop: currentCrop.trim() || undefined,
        history: historyPayload,
        autoFetchContext,
        farmContext: {
          farmName: parcelLabel,
          boundary: selectedBoundaryPayload ?? undefined,
          growingSeason,
          farmingSystem,
          irrigationAvailable: farmingSystem !== 'rainfed',
          currentCrop: currentCrop.trim() || undefined,
          labSoilTest: activeLabTest,
          weatherTelemetry,
          climateTrends,
          soilProfile,
          soilMoisture,
          ecostressPayload: ecostressResult ?? undefined,
          hlsPayload: hlsResult ?? undefined,
          environmentalAnalytics: environmentalAnalytics ?? undefined,
          farmIntelligence: farmIntelligence ?? undefined,
        },
      });

      const assistantEntry: ChatMessageEntry = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: response.answer,
        language: response.language,
        response,
      };
      setMessages((prev) => [...prev, assistantEntry]);
      setTimeout(() => {
        threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }, 50);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : language === 'hi'
            ? 'AI सहायक से संपर्क करने में समस्या आई। कृपया पुनः प्रयास करें।'
            : 'Unable to reach the Gemini agricultural assistant right now. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      {/* Header & Language / Farm Context Controls */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Module 09 · Grounded Gemini Agricultural Advisor
            </p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">
              {language === 'hi'
                ? 'फील्डशिफ्ट कृषि AI सहायक (FieldShift AI Advisor)'
                : 'FieldShift Agricultural AI Assistant'}
            </h1>
            <p className="mt-1 text-xs text-slate-600">
              {language === 'hi' ? 'चयनित खेत:' : 'Selected Farm:'}{' '}
              <span className="font-semibold text-slate-800">{parcelLabel}</span> ·{' '}
              <span className="font-mono tabular-nums text-slate-700">
                {activeCoordinates.latitude.toFixed(4)}°, {activeCoordinates.longitude.toFixed(4)}°
              </span>
              {activeLabTest && (
                <>
                  {' '}
                  · <span className="font-medium text-emerald-700">Lab Soil Calibrated</span>
                </>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onReturnToMap}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap cursor-pointer"
            >
              <MapPin className="h-3.5 w-3.5" />
              {language === 'hi' ? 'मानचित्र पर चुनें' : 'Select Farm on Map'}
            </button>

            <div
              role="group"
              aria-label="Assistant language"
              className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 p-0.5 text-xs"
            >
              <button
                type="button"
                onClick={() => setLanguage('en')}
                className={`inline-flex items-center gap-1 rounded px-2.5 py-1.5 font-medium cursor-pointer ${
                  language === 'en'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Languages className="h-3.5 w-3.5" />
                English
              </button>
              <button
                type="button"
                onClick={() => setLanguage('hi')}
                className={`inline-flex items-center gap-1 rounded px-2.5 py-1.5 font-medium cursor-pointer ${
                  language === 'hi'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                हिन्दी
              </button>
            </div>

            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setMessages([]);
                  setError(null);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 whitespace-nowrap cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {language === 'hi' ? 'चैट साफ़ करें' : 'Clear Chat'}
              </button>
            )}
          </div>
        </div>

        {/* Farm Operational Context Controls */}
        <div className="mt-4 grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2 lg:grid-cols-4 text-xs">
          <div>
            <label htmlFor="ai-season" className="block text-[11px] font-medium text-slate-600">
              {language === 'hi' ? 'फसल मौसम (Season)' : 'Target Growing Season'}
            </label>
            <select
              id="ai-season"
              value={growingSeason}
              onChange={(e) => setGrowingSeason(e.target.value as CropGrowingSeason)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
            >
              <option value="Kharif">Kharif (Monsoon)</option>
              <option value="Rabi">Rabi (Winter)</option>
              <option value="Summer">Summer</option>
              <option value="Zaid">Zaid</option>
            </select>
          </div>

          <div>
            <label htmlFor="ai-farming" className="block text-[11px] font-medium text-slate-600">
              {language === 'hi' ? 'सिंचाई प्रणाली (Irrigation)' : 'Farming System'}
            </label>
            <select
              id="ai-farming"
              value={farmingSystem}
              onChange={(e) => setFarmingSystem(e.target.value as FarmingSystemMode)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
            >
              <option value="rainfed">Rainfed Only</option>
              <option value="supplemental">Supplemental Irrigation</option>
              <option value="irrigated">Irrigated Available</option>
            </select>
          </div>

          <div>
            <label htmlFor="ai-current-crop" className="block text-[11px] font-medium text-slate-600">
              {language === 'hi' ? 'वर्तमान फसल (Current Crop)' : 'Current / Baseline Crop'}
            </label>
            <input
              id="ai-current-crop"
              type="text"
              value={currentCrop}
              onChange={(e) => setCurrentCrop(e.target.value)}
              placeholder="e.g., Soybean, Sorghum, Chickpea"
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
            />
          </div>

          <div className="flex items-end pb-1">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={autoFetchContext}
                onChange={(e) => setAutoFetchContext(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
              />
              <span>
                {language === 'hi'
                  ? 'NASA मौसम, SMAP व SoilGrids स्वतः जोड़ें'
                  : 'Auto-fetch live NASA & SoilGrids context'}
              </span>
            </label>
          </div>
        </div>
      </section>

      {/* Main Split Workspace: Chat Column + Grounded Context & Citations Sidebar */}
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        {/* Left: Conversation Area */}
        <div className="flex flex-col rounded-lg border border-slate-200 bg-white">
          {/* Suggested Questions Bar */}
          <div className="border-b border-slate-200 bg-slate-50/70 p-4">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <HelpCircle className="h-3.5 w-3.5 text-blue-600" />
              {language === 'hi' ? 'सुझाए गए प्रश्न (Suggested Questions)' : 'Suggested Farmer Questions'}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {SUGGESTED_QUESTIONS.map((q) => {
                const label = language === 'hi' ? q.hi : q.en;
                return (
                  <button
                    key={q.en}
                    type="button"
                    disabled={loading}
                    onClick={() => void submitQuestion(label)}
                    className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-left text-xs text-slate-700 hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-800 disabled:opacity-50 cursor-pointer transition-colors"
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Messages Thread */}
          <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5 min-h-[380px] max-h-[620px]">
            {messages.length === 0 && !loading && (
              <div className="flex h-full flex-col items-center justify-center py-10 text-center">
                <MessageSquare className="h-8 w-8 text-blue-600" />
                <h2 className="mt-3 text-sm font-semibold text-slate-900">
                  {language === 'hi'
                    ? 'अपने खेत के डेटा के आधार पर प्रश्न पूछें'
                    : 'Ask questions grounded in your parcel’s NASA & soil intelligence'}
                </h2>
                <p className="mt-1.5 max-w-lg text-xs text-slate-600 leading-relaxed">
                  {language === 'hi'
                    ? 'सहायक NASA POWER मौसम, GPM वर्षा, SMAP नमी, ECOSTRESS ET/ESI, Landsat/HLS NDVI/NDWI, SoilGrids/लैब मिट्टी, ICAR फसल ज्ञान और फसल चक्र परिणामों के आधार पर स्पष्ट उत्तर देता है और उपलब्ध न होने पर सीमाओं को बताता है।'
                    : 'The assistant synthesizes NASA POWER weather, GPM IMERG rainfall, NASA SMAP soil moisture, ECOSTRESS ET/ESI, Landsat/HLS NDVI/NDWI, ISRIC SoilGrids / lab tests, ICAR crop knowledge, and deterministic crop & rotation engines while explicitly flagging missing inputs.'}
                </p>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'user' ? (
                  <div className="max-w-xl rounded-lg border border-blue-200 bg-blue-600 px-4 py-2.5 text-xs text-white">
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                  </div>
                ) : (
                  <article className="w-full space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-4 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 pb-2 text-[11px] text-slate-500">
                      <span className="font-semibold text-slate-800">
                        FieldShift Grounded Advisor
                      </span>
                      {msg.response && (
                        <span className="font-mono">
                          {msg.response.model} · {msg.response.language.toUpperCase()}
                        </span>
                      )}
                    </div>

                    <div className="whitespace-pre-wrap text-sm text-slate-800 leading-relaxed">
                      {msg.text}
                    </div>

                    {msg.response && msg.response.actionSteps.length > 0 && (
                      <div className="rounded-md border border-slate-200 bg-white p-3">
                        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-800">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {msg.language === 'hi' ? 'सुझाए गए कदम' : 'Recommended Next Steps'}
                        </h3>
                        <ul className="mt-1.5 list-disc space-y-1 pl-4 text-slate-700">
                          {msg.response.actionSteps.map((step, idx) => (
                            <li key={idx}>{step}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Conflicts Warning */}
                    {msg.response && msg.response.dataConflicts.length > 0 && (
                      <div className="rounded-md border border-amber-200 bg-amber-50/80 p-3 space-y-1.5">
                        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-900">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {msg.language === 'hi'
                            ? 'डेटा में विसंगतियाँ मिलीं'
                            : 'Environmental Data Conflicts Detected'}
                        </h3>
                        {msg.response.dataConflicts.map((c, idx) => (
                          <div key={idx} className="text-[11px] text-amber-950">
                            <span className="font-semibold">{c.topic}:</span> {c.observationA} vs.{' '}
                            {c.observationB}. {c.guidance}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Evidence Distinction: Measurements vs Estimates vs Missing */}
                    {msg.response && (
                      <div className="grid gap-2.5 md:grid-cols-3">
                        <div className="rounded border border-slate-200 bg-white p-2.5">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                            {msg.language === 'hi' ? 'मापे गए डेटा (Measured)' : 'Measured & Satellite'}
                          </div>
                          <ul className="mt-1 space-y-1 text-[11px] text-slate-600">
                            {msg.response.measurementsUsed.length > 0 ? (
                              msg.response.measurementsUsed.map((item, idx) => (
                                <li key={idx}>• {item}</li>
                              ))
                            ) : (
                              <li>None available</li>
                            )}
                          </ul>
                        </div>

                        <div className="rounded border border-slate-200 bg-white p-2.5">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-blue-700">
                            {msg.language === 'hi' ? 'अनुमान व मॉडल (Estimates)' : 'Modelled Estimates & Engines'}
                          </div>
                          <ul className="mt-1 space-y-1 text-[11px] text-slate-600">
                            {msg.response.estimatesUsed.length > 0 ? (
                              msg.response.estimatesUsed.map((item, idx) => (
                                <li key={idx}>• {item}</li>
                              ))
                            ) : (
                              <li>None generated</li>
                            )}
                          </ul>
                        </div>

                        <div className="rounded border border-slate-200 bg-white p-2.5">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                            {msg.language === 'hi' ? 'अनुपलब्ध जानकारी (Missing)' : 'Missing / Limitations'}
                          </div>
                          <ul className="mt-1 space-y-1 text-[11px] text-slate-600">
                            {msg.response.missingDataIdentified.length > 0 ? (
                              msg.response.missingDataIdentified.map((item, idx) => (
                                <li key={idx}>• {item}</li>
                              ))
                            ) : (
                              <li>No critical gaps identified</li>
                            )}
                          </ul>
                        </div>
                      </div>
                    )}

                    {/* Safety Disclaimer & KVK Advisory */}
                    {msg.response && (
                      <div className="flex items-start gap-2 rounded border border-slate-200 bg-white p-2.5 text-[11px] text-slate-600">
                        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                        <div className="space-y-0.5">
                          <p className="font-medium text-slate-800">{msg.response.safetyDisclaimer}</p>
                          <p>{msg.response.expertConsultationNote}</p>
                        </div>
                      </div>
                    )}
                  </article>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                <span>
                  {language === 'hi'
                    ? 'NASA, मिट्टी और फसल डेटा के आधार पर उत्तर तैयार हो रहा है…'
                    : 'Assembling parcel observations and generating grounded guidance…'}
                </span>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                <span>{error}</span>
              </div>
            )}

            <div ref={threadEndRef} />
          </div>

          {/* Prompt Composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitQuestion(promptInput);
            }}
            className="border-t border-slate-200 bg-slate-50/70 p-3 sm:p-4"
          >
            <div className="flex gap-2">
              <input
                type="text"
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                disabled={loading}
                maxLength={2000}
                placeholder={
                  language === 'hi'
                    ? 'अपना प्रश्न हिन्दी या अंग्रेजी में लिखें (जैसे: क्या सोयाबीन या चना मेरी मिट्टी के लिए ठीक है?)…'
                    : 'Ask about crop suitability, soil limits, rainfall, water conservation, or rotations…'
                }
                className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={loading || promptInput.trim().length < 3}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                <Send className="h-3.5 w-3.5" />
                {language === 'hi' ? 'पूछें' : 'Ask Advisor'}
              </button>
            </div>
          </form>
        </div>

        {/* Right Sidebar: Active Farm Context & Verified Source References */}
        <aside className="space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white p-4 text-xs space-y-2.5">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">
              <Database className="h-3.5 w-3.5 text-blue-600" />
              {language === 'hi' ? 'सक्रिय खेत संदर्भ' : 'Active Farm Context'}
            </h2>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Parcel</span>
                <span className="font-medium text-right text-slate-800">{parcelLabel}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">POWER Weather</span>
                <span className="font-mono text-slate-800">
                  {weatherTelemetry
                    ? `${weatherTelemetry.summary.meanTempC?.toFixed(1) ?? 'N/A'}°C · ${weatherTelemetry.summary.totalPrecipitationMm.toFixed(0)}mm`
                    : autoFetchContext
                      ? 'Auto-fetch on ask'
                      : 'Not loaded'}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">SMAP Moisture</span>
                <span className="font-mono text-slate-800">
                  {soilMoisture?.rootZoneMoistureM3M3 !== null &&
                  soilMoisture?.rootZoneMoistureM3M3 !== undefined
                    ? `${soilMoisture.rootZoneMoistureM3M3.toFixed(3)} m³/m³`
                    : autoFetchContext
                      ? 'Auto-fetch on ask'
                      : 'Not loaded'}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Soil pH</span>
                <span className="font-mono tabular-nums text-slate-800">
                  {activeLabTest?.ph !== null && activeLabTest?.ph !== undefined
                    ? `${activeLabTest.ph.toFixed(1)} (Lab)`
                    : soilProfile?.surfaceSummary.ph.mean !== null &&
                        soilProfile?.surfaceSummary.ph.mean !== undefined
                      ? `${soilProfile.surfaceSummary.ph.mean.toFixed(1)} (SoilGrids)`
                      : autoFetchContext
                        ? 'Auto-fetch on ask'
                        : 'Unavailable'}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">ECOSTRESS ET / ESI</span>
                <span className="font-mono tabular-nums text-right text-slate-800">
                  {latestEcoView &&
                  (latestEcoView.latestEtWm2 !== null || latestEcoView.latestEsiRatio !== null)
                    ? `${latestEcoView.latestEtWm2 !== null ? `${latestEcoView.latestEtWm2.toFixed(1)} W/m²` : 'ET —'} · ${latestEcoView.latestEsiRatio !== null ? `ESI ${latestEcoView.latestEsiRatio.toFixed(2)}` : 'ESI —'} (${formatShortDate(latestEcoView.etObservationDate ?? latestEcoView.esiObservationDate)})`
                    : autoFetchContext
                      ? 'Auto-fetch on ask'
                      : 'Not loaded'}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Landsat/HLS NDVI / NDWI</span>
                <span className="font-mono tabular-nums text-right text-slate-800">
                  {latestHlsView &&
                  (latestHlsView.latestNdvi !== null || latestHlsView.latestNdwi !== null)
                    ? `${latestHlsView.latestNdvi !== null ? latestHlsView.latestNdvi.toFixed(2) : '—'} / ${latestHlsView.latestNdwi !== null ? latestHlsView.latestNdwi.toFixed(2) : '—'} (${formatShortDate(latestHlsView.ndviAcquisitionDate ?? latestHlsView.ndwiAcquisitionDate)})`
                    : autoFetchContext
                      ? 'Auto-fetch on ask'
                      : 'Not loaded'}
                </span>
              </div>
              {farmIntelligence && (
                <div className="flex justify-between gap-2 border-t border-slate-200 pt-1.5">
                  <span className="text-slate-500">Farm Posture (Phase 5)</span>
                  <span className="font-mono uppercase text-right text-slate-900">
                    {farmIntelligence.postureStatus.replaceAll('_', ' ')} ·{' '}
                    {farmIntelligence.actionRecommendations.recommendations.length} action(s)
                  </span>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 text-xs space-y-2.5">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">
              <BookOpen className="h-3.5 w-3.5 text-emerald-700" />
              {language === 'hi' ? 'स्रोत संदर्भ (Sources)' : 'Source References'}
            </h2>
            {lastAssistantResponse ? (
              <div className="space-y-2">
                {lastAssistantResponse.sourceCitations.map((src) => (
                  <div
                    key={src.sourceId}
                    className="rounded border border-slate-200 bg-slate-50/70 p-2.5 text-[11px]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">{src.label}</span>
                      <span
                        className={`font-mono uppercase text-[10px] ${
                          src.status === 'available'
                            ? 'text-emerald-700'
                            : src.status === 'partial'
                              ? 'text-amber-700'
                              : 'text-slate-500'
                        }`}
                      >
                        {src.status}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-500">
                      {src.category.replaceAll('_', ' ')}
                    </div>
                    <p className="mt-1 text-slate-600">{src.summary}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-slate-500 leading-relaxed">
                {language === 'hi'
                  ? 'प्रश्न पूछने के बाद यहाँ NASA POWER, GPM IMERG, SMAP, ISRIC SoilGrids और ICAR स्रोतों की स्थिति दिखेगी।'
                  : 'Ask a question to inspect live provenance and status across NASA POWER, GPM IMERG, SMAP, SoilGrids, Lab Soil Tests, and ICAR Crop Knowledge.'}
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

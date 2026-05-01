import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  Competition,
  Swimmer,
  Entry,
  PoolSize,
  PoolDistance,
  Stroke,
  SeededEvent,
  CompetitionEvent,
  Heat
} from './types';
import { Icons, STROKES, CATEGORY_ORDER, GENDER_ORDER } from './constants';
import { parseTimeToMs, formatMsToTime, calculateInitialSeeding, buildHeatsFromState, getCategoryByBirthYear } from './services/seedingLogic';

const TIME_REGEX = /^(\d{1,2}):([0-5]\d),(\d{2})$/;

declare global {
  interface Window {
    html2pdf: any;
  }
}

const ResultIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
);

const TrophyIcon = ({ color = "currentColor" }: { color?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path><path d="M4 22h16"></path><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"></path></svg>
);

const SlipIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 2H8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"></path><path d="M12 18h.01"></path><path d="M10 6h4"></path><path d="M10 10h4"></path><path d="M10 14h4"></path></svg>
);

const PreviewIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
);

type SortKey = 'none' | 'distance' | 'stroke' | 'category' | 'gender';

export const App: React.FC = () => {
  const [competition, setCompetition] = useState<Competition>(() => {
    const saved = localStorage.getItem('swimManager_competition');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Error parsing stored competition data", e);
      }
    }
    return {
      name: 'Championnat Regional de Natation',
      poolSize: 8,
      poolDistance: 25,
      clubs: ['Indépendant'],
      swimmers: [],
      events: [],
      entries: [],
    };
  });

  useEffect(() => {
    localStorage.setItem('swimManager_competition', JSON.stringify(competition));
  }, [competition]);

  const [activeTab, setActiveTab] = useState<'setup' | 'clubs' | 'swimmers' | 'seeding' | 'results'>('setup');
  const [showAddSwimmer, setShowAddSwimmer] = useState(false);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [showAddEngagement, setShowAddEngagement] = useState<Swimmer | null>(null);
  const [showAddRelayEngagement, setShowAddRelayEngagement] = useState<string | null>(null);
  const [selectedSwimmerProfile, setSelectedSwimmerProfile] = useState<Swimmer | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const backupInputRef = useRef<HTMLInputElement>(null);

  const [editMode, setEditMode] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');
  const [selectedSlot, setSelectedSlot] = useState<{ eventId: string, heat: number, lane: number } | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [minHeats, setMinHeats] = useState<Record<string, number>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [clubSearchTerm, setClubSearchTerm] = useState('');
  const [reorderEventId, setReorderEventId] = useState<string | null>(null);

  // Options d'affichage
  const [showEntryTimes, setShowEntryTimes] = useState(true);
  const [pdfOrientation, setPdfOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [pdfCompactMode, setPdfCompactMode] = useState(false);
  const [pdfColumns, setPdfColumns] = useState<1 | 2>(1);
  const [printSlipsMode, setPrintSlipsMode] = useState(false);

  const [engagementError, setEngagementError] = useState<string | null>(null);
  const [resultErrors, setResultErrors] = useState<Record<string, string>>({});

  const [resultFilterStroke, setResultFilterStroke] = useState<string>('Tous');
  const [resultFilterCategory, setResultFilterCategory] = useState<string>('Tous');
  const [resultFilterGender, setResultFilterGender] = useState<string>('Tous');

  const [swimmerClubFilter, setSwimmerClubFilter] = useState<string>('Tous');

  // Club Rankings Calculation (MeetManager Style Scoring)
  const clubScores = useMemo(() => {
    const scores: Record<string, { total: number, gold: number, silver: number, bronze: number }> = {};
    const pointsScale = [20, 17, 16, 15, 14, 13, 12, 11, 9, 7, 6, 5, 4, 3, 2, 1];

    competition.entries.forEach((entry: Entry) => {
      if (entry.rank && entry.rank <= pointsScale.length) {
        let clubName = '';
        if (entry.isRelay && entry.relayClub) {
          clubName = entry.relayClub;
        } else {
          const swimmer = competition.swimmers.find((s: Swimmer) => s.id === entry.swimmerId);
          if (swimmer) clubName = swimmer.club;
        }

        if (clubName) {
          if (!scores[clubName]) {
            scores[clubName] = { total: 0, gold: 0, silver: 0, bronze: 0 };
          }

          let points = pointsScale[entry.rank - 1];
          if (entry.isRelay) points *= 2;

          scores[clubName].total += points;
          if (entry.rank === 1) scores[clubName].gold += 1;
          if (entry.rank === 2) scores[clubName].silver += 1;
          if (entry.rank === 3) scores[clubName].bronze += 1;
        }
      }
    });

    return Object.entries(scores)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.total - a.total || b.gold - a.gold);
  }, [competition.entries, competition.swimmers, competition.clubs]);

  // Global Dashboard Statistics
  const dashboardStats = useMemo(() => {
    const totalSwimmers = competition.swimmers.length;
    const males = competition.swimmers.filter((s: Swimmer) => s.gender === 'M').length;
    const females = competition.swimmers.filter((s: Swimmer) => s.gender === 'F').length;

    const clubBreakdown = competition.clubs.map((club: string) => {
      const swimmers = competition.swimmers.filter((s: Swimmer) => s.club === club);
      return {
        name: club,
        total: swimmers.length,
        m: swimmers.filter((s: Swimmer) => s.gender === 'M').length,
        f: swimmers.filter((s: Swimmer) => s.gender === 'F').length
      };
    }).sort((a: any, b: any) => b.total - a.total);

    return { totalSwimmers, males, females, clubBreakdown };
  }, [competition.swimmers, competition.clubs]);

  // Filtres Départs (Seeding)
  const [seedingFilterStroke, setSeedingFilterStroke] = useState<string>('Tous');
  const [seedingFilterCategory, setSeedingFilterCategory] = useState<string>('Tous');
  const [seedingFilterGender, setSeedingFilterGender] = useState<string>('Tous');

  const [sortCriteria, setSortCriteria] = useState<{ key: SortKey, direction: 'asc' | 'desc' }>({ key: 'none', direction: 'asc' });

  const [newSwimmerYear, setNewSwimmerYear] = useState<number>(new Date().getFullYear() - 12);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const programRef = useRef<HTMLDivElement>(null);

  const isValidTimeFormat = (val: string) => {
    if (val.toUpperCase() === 'NT') return true;
    return TIME_REGEX.test(val);
  };

  const getStrokeIcon = (stroke: string) => {
    switch (stroke) {
      case 'Nage Libre': return '🏊';
      case 'Dos': return '🚣';
      case 'Brasse': return '🐸';
      case 'Papillon': return '🦋';
      case '4 Nages': return '🎭';
      default: return '🌊';
    }
  };

  const getHeatStatus = (assignments: any[]) => {
    const filled = assignments.filter(a => a.swimmer || a.entry?.isRelay).length;
    if (filled === 0) return { label: 'Vide', color: 'text-slate-400 bg-slate-100' };
    if (filled === assignments.length) return { label: 'Complet', color: 'text-emerald-600 bg-emerald-50 border-emerald-100' };
    return { label: `${filled}/${assignments.length}`, color: 'text-blue-600 bg-blue-50 border-blue-100' };
  };

  const autoSeedAll = useCallback(() => {
    setCompetition((prev: Competition) => {
      let updatedEntries = [...prev.entries];
      let hasChanges = false;

      prev.events.forEach((event: CompetitionEvent) => {
        const hasAssignments = updatedEntries.some((e: Entry) => e.eventId === event.id && e.heat);
        if (!hasAssignments) {
          const assignments = calculateInitialSeeding(event, updatedEntries, prev.poolSize);
          assignments.forEach((assign: any) => {
            const entryIndex = updatedEntries.findIndex(e => e.id === assign.entryId);
            if (entryIndex >= 0) {
              updatedEntries[entryIndex] = { ...updatedEntries[entryIndex], heat: assign.heat, lane: assign.lane };
              hasChanges = true;
            }
          });
        }
      });
      return hasChanges ? { ...prev, entries: updatedEntries } : prev;
    });
  }, []);

  useEffect(() => {
    if (activeTab === 'seeding' && competition.entries.length > 0) {
      autoSeedAll();
    }
  }, [activeTab, competition.events.length, autoSeedAll]);

  const seededEvents: SeededEvent[] = useMemo(() => {
    const sortedEvents = [...competition.events].sort((a, b) => {
      if (sortCriteria.key === 'none') {
        const catA = CATEGORY_ORDER.indexOf(a.ageCategory);
        const catB = CATEGORY_ORDER.indexOf(b.ageCategory);
        if (catA !== catB) return catA - catB;
        const genderA = GENDER_ORDER.indexOf(a.gender as string);
        const genderB = GENDER_ORDER.indexOf(b.gender as string);
        if (genderA !== genderB) return genderA - genderB;
        if (a.distance !== b.distance) return a.distance - b.distance;
        return STROKES.indexOf(a.stroke) - STROKES.indexOf(b.stroke);
      }
      let comparison = 0;
      switch (sortCriteria.key) {
        case 'distance': comparison = a.distance - b.distance; break;
        case 'stroke': comparison = STROKES.indexOf(a.stroke) - STROKES.indexOf(b.stroke); break;
        case 'category': comparison = CATEGORY_ORDER.indexOf(a.ageCategory) - CATEGORY_ORDER.indexOf(b.ageCategory); break;
        case 'gender': comparison = GENDER_ORDER.indexOf(a.gender as string) - GENDER_ORDER.indexOf(b.gender as string); break;
      }
      return sortCriteria.direction === 'asc' ? comparison : -comparison;
    });

    return sortedEvents
      .map(event => ({
        event,
        heats: buildHeatsFromState(event, competition.entries, competition.swimmers, competition.poolSize, minHeats[event.id] || 0)
      }))
      .filter(se => se.heats.length > 0 || (minHeats[se.event.id] && minHeats[se.event.id] > 0));
  }, [competition.entries, competition.events, competition.swimmers, competition.poolSize, minHeats, sortCriteria]);

  const filteredSeededEvents = useMemo(() => {
    return seededEvents.filter(se => {
      const matchStroke = seedingFilterStroke === 'Tous' || se.event.stroke === seedingFilterStroke;
      const matchCategory = seedingFilterCategory === 'Tous' || se.event.ageCategory === seedingFilterCategory;
      const matchGender = seedingFilterGender === 'Tous' || se.event.gender === seedingFilterGender;
      return matchStroke && matchCategory && matchGender;
    });
  }, [seededEvents, seedingFilterStroke, seedingFilterCategory, seedingFilterGender]);

  const filteredSwimmers = useMemo(() => {
    return competition.swimmers.filter((s: Swimmer) => {
      const matchSearch = searchTerm === '' ||
        s.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.firstName.toLowerCase().includes(searchTerm.toLowerCase());
      const matchClub = swimmerClubFilter === 'Tous' || s.club === swimmerClubFilter;
      return matchSearch && matchClub;
    });
  }, [competition.swimmers, searchTerm, swimmerClubFilter]);

  const handleUpdateResult = (entryId: string, timeValue: string) => {
    if (timeValue !== '' && !isValidTimeFormat(timeValue)) {
      setResultErrors(prev => ({ ...prev, [entryId]: 'Format MM:SS,00 requis' }));
      return;
    }
    setResultErrors(prev => { const next = { ...prev }; delete next[entryId]; return next; });
    const ms = parseTimeToMs(timeValue);
    const formatted = formatMsToTime(ms);

    setCompetition((prev: Competition) => {
      let nextEntries = prev.entries.map((e: Entry) => (e.id === entryId) ? { ...e, resultTime: formatted, resultTimeMs: ms === Infinity ? null : ms } : e);
      const updatedEntry = nextEntries.find((e: Entry) => e.id === entryId);
      if (updatedEntry) {
        const eventId = updatedEntry.eventId;
        const event = prev.events.find((ev: CompetitionEvent) => ev.id === eventId);
        const pointsScale = [20, 17, 16, 15, 14, 13, 12, 11, 9, 7, 6, 5, 4, 3, 2, 1];
        const sortedEntries = nextEntries.filter((e: Entry) => e.eventId === eventId && e.resultTimeMs).sort((a: Entry, b: Entry) => (a.resultTimeMs || 0) - (b.resultTimeMs || 0));
        nextEntries = nextEntries.map(e => {
          if (e.eventId !== eventId) return e;
          const rankIdx = sortedEntries.findIndex(s => s.id === e.id);
          const rank = rankIdx !== -1 ? rankIdx + 1 : null;
          let points: number | null = null;
          if (rank && rank <= pointsScale.length) {
            points = pointsScale[rank - 1];
            if (event?.isRelay) points *= 2;
          }
          return { ...e, rank, points };
        });
      }
      return { ...prev, entries: nextEntries };
    });
  };

  const generatePDF = async (ref: React.RefObject<HTMLDivElement | null>, filename: string, action: 'save' | 'preview' = 'save') => {
    const element = ref.current;
    if (!element) return;

    // Browser canvases typically fail around 15k-30k pixels depending on the engine.
    // We set a proactive limit to avoid hard crashes and inform the user.
    const isTooLarge = element.scrollHeight > 15000;

    if (isTooLarge) {
      alert(
        "Ce document est trop long pour la génération PDF automatique (limite technique du navigateur atteinte).\n\n" +
        "SOLUTION :\n" +
        "Le menu d'impression système va s'ouvrir. Veuillez sélectionner 'Enregistrer au format PDF' dans les options de destination de votre imprimante."
      );
      window.print();
      return;
    }

    if (window.hasOwnProperty('html2pdf')) {
      const opt = {
        margin: [5, 5, 5, 5],
        filename: `${filename}.pdf`,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 1.5, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: pdfOrientation },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
      };

      try {
        const worker = (window as any).html2pdf().set(opt).from(element);
        if (action === 'save') {
          await worker.save();
        } else {
          const pdfUrl = await worker.output('bloburl');
          window.open(pdfUrl, '_blank');
        }
      } catch (err: any) {
        console.warn("HTML2PDF failed, falling back to system print.", err);

        let errorMsg = "Une erreur est survenue lors de la création du PDF.";
        if (err?.message && (err.message.includes('exceeds max size') || err.message.includes('canvas'))) {
          errorMsg = "La taille du contenu dépasse la capacité de traitement du navigateur.";
        }

        if (action === 'save') {
          alert(
            `${errorMsg}\n\n` +
            "REPLI AUTOMATIQUE :\n" +
            "L'impression système va s'ouvrir. Veuillez choisir 'Enregistrer au format PDF' pour sauvegarder votre document."
          );
          window.print();
        } else {
          alert("L'aperçu PDF n'a pas pu être généré. Essayez de télécharger le fichier ou utilisez l'aperçu avant impression du navigateur (CTRL+P).");
        }
      }
    } else {
      // Should not happen if CDN is loaded, but safe fallback
      window.print();
    }
  };

  const handleDownloadPDF = async () => {
    const wasViewMode = viewMode;
    if (viewMode !== 'list') setViewMode('list');

    // Allow React to render list view before generating PDF
    setTimeout(async () => {
      await generatePDF(programRef, `${competition.name.replace(/\s+/g, '_')}_FeuilleDepart`, 'save');
      if (wasViewMode !== 'list') setViewMode(wasViewMode);
    }, 500);
  };

  const handlePreviewPDF = async () => {
    const wasViewMode = viewMode;
    if (viewMode !== 'list') setViewMode('list');

    setTimeout(async () => {
      await generatePDF(programRef, `${competition.name.replace(/\s+/g, '_')}_FeuilleDepart`, 'preview');
      if (wasViewMode !== 'list') setViewMode(wasViewMode);
    }, 500);
  };

  const handlePrintSlips = () => {
    setPrintSlipsMode(true);
    setTimeout(() => {
      window.print();
      setPrintSlipsMode(false);
    }, 500);
  };

  const handleExportResultsExcel = () => {
    const data: any[] = [];
    competition.events.forEach((event: CompetitionEvent, idx: number) => {
      const eventEntries = competition.entries.filter((e: Entry) => e.eventId === event.id && e.resultTimeMs).sort((a: Entry, b: Entry) => (a.resultTimeMs || 0) - (b.resultTimeMs || 0));
      if (eventEntries.length > 0) {
        data.push({ 'Rang': `EPREUVE ${idx + 1}`, 'Epreuve': `${event.distance}m ${event.stroke} - ${event.gender}` });
        eventEntries.forEach((e: Entry, rIdx: number) => {
          const s = competition.swimmers.find((sw: Swimmer) => sw.id === e.swimmerId);
          data.push({ 'Rang': rIdx + 1, 'Nom': s?.lastName, 'Prénom': s?.firstName, 'Club': s?.club, 'Temps Eng.': e.entryTime, 'Temps Réalisé': e.resultTime });
        });
        data.push({});
      }
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Resultats");
    XLSX.writeFile(wb, `Resultats_${competition.name}.xlsx`);
  };

  const clearAllData = () => {
    if (window.confirm("Êtes-vous sûr de vouloir tout effacer ? Cette action est irréversible.")) {
      localStorage.removeItem('swimManager_competition');
      setCompetition({
        name: 'Compétition',
        poolSize: 8,
        poolDistance: 25,
        clubs: ['Indépendant'],
        swimmers: [],
        events: [],
        entries: []
      });
      window.location.reload(); // Refresh to clear all other states
    }
  };

  const processImportedData = useCallback((rows: any[]) => {
    if (!rows || rows.length === 0) {
      throw new Error("Le fichier semble vide ou ne contient aucune donnée lisible.");
    }

    const firstRow = rows[0];
    const keys = Object.keys(firstRow);
    const lowerKeys = keys.map(k => k.toLowerCase());

    // Fonction pour trouver une clé par ressemblance
    const findKey = (searchTerms: string[]) => {
      const found = keys.find(k => {
        const lk = k.toLowerCase().trim();
        return searchTerms.some(term => lk.includes(term));
      });
      return found;
    };

    const keyNom = findKey(['nom', 'last name', 'famille']);
    const keyPrenom = findKey(['prénom', 'prenom', 'first name']);
    const keyAnnee = findKey(['année', 'annee', 'birth', 'naiss']);
    const keyClub = findKey(['club', 'equipe', 'équipe', 'team']);
    const keyGenre = findKey(['genre', 'sexe', 'gender', 'se']);

    if (!keyNom || !keyPrenom) {
      const detected = keys.join(', ');
      throw new Error(`Format invalide : Colonnes 'Nom' et 'Prénom' introuvables.\n\nColonnes détectées : ${detected}`);
    }

    const newSwimmers: Swimmer[] = [];
    const newEntries: Entry[] = [];
    const newClubsSet = new Set<string>(competition.clubs);
    const currentEvents = [...competition.events];
    let addedCount = 0;

    rows.forEach((row, index) => {
      const lastName = (row[keyNom] || "").toString().trim().toUpperCase();
      const firstName = (row[keyPrenom] || "").toString().trim();

      if (!lastName || !firstName) return;

      const birthYear = parseInt(row[keyAnnee || ''] || "2010");

      // Duplicate check (normalized)
      const isDuplicate = competition.swimmers.some((s: Swimmer) =>
        s.lastName.toUpperCase() === lastName &&
        s.firstName.toLowerCase() === firstName.toLowerCase() &&
        s.birthYear === birthYear
      );
      if (isDuplicate) return;

      addedCount++;
      const clubName = (row[keyClub || ''] || "Indépendant").toString().trim();
      newClubsSet.add(clubName);

      const swimmerId = `sw-${lastName}-${firstName}-${index}-${Date.now()}`.replace(/\s+/g, '-');
      const gRaw = (row[keyGenre || ''] || "M").toString().toUpperCase();
      const gender = gRaw.startsWith('F') || gRaw.startsWith('D') ? 'F' : 'M';

      const swimmer: Swimmer = { id: swimmerId, lastName, firstName, club: clubName, birthYear, gender };
      newSwimmers.push(swimmer);

      // Process other columns as potential events
      Object.keys(row).forEach(key => {
        if ([keyNom, keyPrenom, keyAnnee, keyClub, keyGenre].includes(key)) return;

        const val = row[key];
        if (!val) return;

        const rawVal = val.toString().trim().toUpperCase();
        const timeMs = parseTimeToMs(rawVal);
        const isEngagementMarker = rawVal === 'X' || rawVal === '1' || rawVal === 'OUI' || rawVal === 'OK';

        if (timeMs === Infinity && rawVal !== 'NT' && !isEngagementMarker) return;

        const lKey = key.toLowerCase();
        const distMatch = key.match(/\d+/);
        const distance = distMatch ? parseInt(distMatch[0]) : 50;

        let stroke: Stroke = 'Nage Libre';
        if (lKey.includes('dos')) stroke = 'Dos';
        else if (lKey.includes('bras')) stroke = 'Brasse';
        else if (lKey.includes('pap')) stroke = 'Papillon';
        else if (lKey.includes('4n') || lKey.includes('im') || lKey.includes('méd')) stroke = '4 Nages';
        else if (lKey.includes('nl') || lKey.includes('libre')) stroke = 'Nage Libre';

        const eventId = `ev-${stroke}-${distance}-${gender}-${getCategoryByBirthYear(birthYear)}`.replace(/\s+/g, '-');
        let event = currentEvents.find(e => e.id === eventId);
        if (!event) {
          event = { id: eventId, distance, stroke, gender, ageCategory: getCategoryByBirthYear(birthYear) };
          currentEvents.push(event);
        }
        newEntries.push({ id: `en-${swimmerId}-${eventId}`, swimmerId, eventId: event.id, entryTime: formatMsToTime(timeMs), entryTimeMs: timeMs, heat: null, lane: null });
      });
    });

    if (addedCount === 0) {
      alert("Aucun nouveau nageur n'a été importé.\n\nNote : Les nageurs déjà présents sont ignorés pour éviter les doublons.");
      return;
    }

    setCompetition((prev: Competition) => ({
      ...prev,
      clubs: Array.from(newClubsSet),
      swimmers: [...prev.swimmers, ...newSwimmers],
      events: currentEvents,
      entries: [...prev.entries, ...newEntries]
    }));

    setSwimmerClubFilter('Tous');
    setSearchTerm('');

    alert(`Importation réussie : ${addedCount} nouveaux nageurs ajoutés.`);
  }, [competition.events, competition.swimmers, competition.clubs]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        if (!wb.SheetNames.length) throw new Error("Le fichier Excel ne contient aucune feuille.");

        const jsonData = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as any[];
        processImportedData(jsonData);
      } catch (err: any) {
        console.error("Import Error:", err);
        alert("Échec de l'importation :\n" + (err.message || "Erreur technique"));
      } finally {
        setIsImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.onerror = () => {
      alert("Erreur technique lors de la lecture du fichier.");
      setIsImporting(false);
    };
    reader.readAsArrayBuffer(file);
  };

  const addSwimmer = (s: Omit<Swimmer, 'id'>) => { setCompetition(prev => ({ ...prev, swimmers: [...prev.swimmers, { ...s, id: crypto.randomUUID() }] })); setShowAddSwimmer(false); };
  const createEvent = (data: Omit<CompetitionEvent, 'id'>) => { setCompetition(prev => ({ ...prev, events: [...prev.events, { ...data, id: `ev-${data.stroke}-${data.distance}-${data.gender}-${data.ageCategory}`.replace(/\s+/g, '-') }] })); setShowAddEvent(false); };
  const deleteSwimmer = (id: string) => { setCompetition(prev => ({ ...prev, swimmers: prev.swimmers.filter(s => s.id !== id), entries: prev.entries.filter(e => e.swimmerId !== id) })); };
  const deleteEvent = (id: string) => { setCompetition(prev => ({ ...prev, events: prev.events.filter(e => e.id !== id), entries: prev.entries.filter(e => e.eventId !== id) })); };

  const moveHeat = (eventId: string, heatNumber: number, direction: 'up' | 'down') => {
    const targetHeat = direction === 'up' ? heatNumber - 1 : heatNumber + 1;
    if (targetHeat < 1) return;
    setCompetition((prev: Competition) => ({ ...prev, entries: prev.entries.map((e: Entry) => (e.eventId === eventId && e.heat === heatNumber) ? { ...e, heat: targetHeat } : (e.eventId === eventId && e.heat === targetHeat) ? { ...e, heat: heatNumber } : e) }));
  };

  const reverseHeats = (eventId: string) => {
    setCompetition((prev: Competition) => {
      const eventEntries = prev.entries.filter((e: Entry) => e.eventId === eventId && typeof e.heat === 'number');
      if (eventEntries.length === 0) return prev;
      // Fixed type inference by specifying generics for Set and Array.from
      const heatNums: number[] = Array.from<number>(new Set(eventEntries.map((e: Entry) => e.heat as number))).sort((a, b) => a - b);
      const maxHeat = Math.max(...heatNums);
      const minHeat = Math.min(...heatNums);
      return { ...prev, entries: prev.entries.map((e: Entry) => (e.eventId === eventId && typeof e.heat === 'number') ? { ...e, heat: maxHeat + minHeat - (e.heat as number) } : e) };
    });
  };

  const handleAddHeat = (eventId: string, currentHeatsCount: number) => {
    setMinHeats((prev: Record<string, number>) => ({
      ...prev,
      [eventId]: Math.max((prev[eventId] || currentHeatsCount) + 1, currentHeatsCount + 1)
    }));
  };

  const handleRemoveHeat = (eventId: string, currentHeatsCount: number) => {
    setMinHeats((prev: Record<string, number>) => {
      const current = prev[eventId] || currentHeatsCount;
      if (current <= 1) return prev;
      return { ...prev, [eventId]: current - 1 };
    });
  };

  const handleSlotClick = (eventId: string, heat: number, lane: number) => {
    if (!editMode) return;

    // Manual assignment from selected list
    if (selectedEntryId) {
      setCompetition((prev: Competition) => {
        const nextEntries = prev.entries.map((e: Entry) => {
          if (e.id === selectedEntryId) return { ...e, heat, lane };
          // If someone else was in this slot, unseed them
          if (e.eventId === eventId && e.heat === heat && e.lane === lane) return { ...e, heat: null, lane: null };
          return e;
        });
        return { ...prev, entries: nextEntries };
      });
      setSelectedEntryId(null);
      return;
    }

    setSelectedSlot((prev: any) => {
      // If same slot clicked, deselect
      if (prev && prev.eventId === eventId && prev.heat === heat && prev.lane === lane) {
        return null;
      }

      if (prev && prev.eventId === eventId) {
        setCompetition((comp: Competition) => {
          const newEntries = [...comp.entries];
          const srcIdx = newEntries.findIndex((e: Entry) => e.eventId === prev.eventId && e.heat === prev.heat && e.lane === prev.lane);
          const tgtIdx = newEntries.findIndex((e: Entry) => e.eventId === eventId && e.heat === heat && e.lane === lane);

          if (srcIdx !== -1 && tgtIdx !== -1) {
            const tempH = newEntries[srcIdx].heat;
            const tempL = newEntries[srcIdx].lane;
            newEntries[srcIdx].heat = newEntries[tgtIdx].heat;
            newEntries[srcIdx].lane = newEntries[tgtIdx].lane;
            newEntries[tgtIdx].heat = tempH;
            newEntries[tgtIdx].lane = tempL;
          }
          else if (srcIdx !== -1) {
            newEntries[srcIdx].heat = heat;
            newEntries[srcIdx].lane = lane;
          }
          else if (tgtIdx !== -1) {
            newEntries[tgtIdx].heat = prev.heat;
            newEntries[tgtIdx].lane = prev.lane;
          }
          return { ...comp, entries: newEntries };
        });
        return null;
      }
      return { eventId, heat, lane };
    });
  };

  const handleUnseedEntry = (entryId: string) => {
    setCompetition((prev: Competition) => ({
      ...prev,
      entries: prev.entries.map((e: Entry) => e.id === entryId ? { ...e, heat: null, lane: null } : e)
    }));
  };

  const updateClubName = (oldName: string) => {
    const newName = window.prompt("Nouveau nom pour ce club :", oldName);
    if (!newName || oldName === newName) return;
    setCompetition((prev: Competition) => ({
      ...prev,
      clubs: prev.clubs.map((c: string) => c === oldName ? newName : c),
      swimmers: prev.swimmers.map((s: Swimmer) => s.club === oldName ? { ...s, club: newName } : s)
    }));
  };

  const resetEventSeeding = (eventId: string) => {
    if (!window.confirm("Réinitialiser toutes les séries pour cette épreuve ?")) return;
    setCompetition((prev: Competition) => ({
      ...prev,
      entries: prev.entries.map((e: Entry) => e.eventId === eventId ? { ...e, heat: null, lane: null } : e)
    }));
    setMinHeats((prev: Record<string, number>) => {
      const next = { ...prev };
      delete next[eventId];
      return next;
    });
  };
  const handleUpdateEntryTime = (entryId: string, newTimeStr: string) => {
    const timeMs = parseTimeToMs(newTimeStr);
    setCompetition((prev: Competition) => ({
      ...prev,
      entries: prev.entries.map((e: Entry) => e.id === entryId ? { ...e, entryTime: formatMsToTime(timeMs), entryTimeMs: timeMs } : e)
    }));
  };

  const handleExportBackup = () => {
    const data = JSON.stringify(competition, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_${competition.name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (json.name && Array.isArray(json.swimmers) && Array.isArray(json.entries)) {
          setCompetition(json);
          alert("Sauvegarde restaurée avec succès !");
        } else {
          alert("Format de fichier invalide.");
        }
      } catch (err) {
        alert("Erreur lors de la lecture du fichier.");
      }
      if (backupInputRef.current) backupInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const timingSlips = useMemo(() => {
    return filteredSeededEvents.flatMap((se, sIdx) =>
      se.heats.flatMap(heat =>
        heat.assignments.filter(a => a.swimmer || a.entry?.isRelay).map(assign => ({
          id: `${se.event.id}-${heat.heatNumber}-${assign.lane}`,
          eventNum: sIdx + 1,
          eventName: `${se.event.distance}m ${se.event.stroke}`,
          eventDetails: `${se.event.gender} (${se.event.ageCategory})`,
          heatNum: heat.heatNumber,
          laneNum: assign.lane,
          swimmerName: assign.entry?.isRelay ? `RELAIS: ${assign.entry?.relayClub}` : `${assign.swimmer?.lastName} ${assign.swimmer?.firstName}`,
          club: assign.entry?.isRelay ? assign.entry?.relayClub : assign.swimmer?.club,
          entryTime: assign.entry?.entryTime
        }))
      )
    );
  }, [filteredSeededEvents]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* Dynamic styles for native print matching PDF orientation */}
      <style>{`
        @media print {
          @page {
            size: ${pdfOrientation};
            margin: 0.5cm;
          }
        }
      `}</style>

      {/* HEADER */}
      <header className="bg-blue-900 text-white shadow-xl no-print z-10 sticky top-0">
        <div className="container mx-auto px-6 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-4 cursor-pointer" onClick={() => setActiveTab('setup')}>
            <div className="bg-white p-2.5 rounded-2xl text-blue-900 shadow-inner"><Icons.Trophy /></div>
            <div><h1 className="text-2xl font-black tracking-tight leading-none">SwimManager Pro</h1><span className="text-[10px] opacity-70 font-bold uppercase tracking-widest text-blue-200">Compétition</span></div>
          </div>
          <nav className="flex bg-white/10 backdrop-blur-md rounded-2xl p-1 overflow-x-auto max-w-full">
            {[{ id: 'setup', label: 'Paramètres', icon: Icons.Settings }, { id: 'clubs', label: 'Clubs', icon: Icons.Trophy }, { id: 'swimmers', label: 'Nageurs', icon: Icons.Users }, { id: 'seeding', label: 'Départs', icon: Icons.Zap }, { id: 'results', label: 'Résultats', icon: ResultIcon }].map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`flex items-center gap-2.5 px-4 sm:px-6 py-2.5 rounded-xl transition-all whitespace-nowrap ${activeTab === tab.id ? 'bg-white text-blue-900 shadow-md font-bold' : 'text-blue-100 hover:bg-white/5 font-medium'}`}>
                <tab.icon /><span className="hidden sm:inline text-sm">{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="flex-grow container mx-auto px-6 py-10 print:p-0">
        {/* TAB SETUP */}
        {activeTab === 'setup' && (
          <div className="max-w-7xl mx-auto space-y-10 animate-in fade-in pb-20">
            {/* TOP ANALYTICS DASHBOARD */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              <div className="lg:col-span-2 bg-slate-900 rounded-[3rem] p-10 text-white shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/20 rounded-full blur-3xl -mr-20 -mt-20"></div>
                <div className="relative z-10 flex flex-col h-full justify-between">
                  <div>
                    <h2 className="text-3xl font-black uppercase tracking-tighter mb-2">Tableau de Bord</h2>
                    <p className="text-slate-400 font-bold text-sm uppercase tracking-widest">{competition.name}</p>
                  </div>
                  <div className="mt-12 grid grid-cols-2 gap-8">
                    <div>
                      <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2">Total Participants</div>
                      <div className="text-5xl font-black text-white">{dashboardStats.totalSwimmers}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2">Clubs Engagés</div>
                      <div className="text-5xl font-black text-blue-400">{competition.clubs.length}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-[3rem] p-10 shadow-xl border border-slate-100">
                <div className="flex justify-between items-center mb-8">
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Répartition Genres</div>
                  <div className="bg-indigo-50 p-2 rounded-xl text-indigo-600"><Icons.Users /></div>
                </div>
                <div className="space-y-6">
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-black uppercase">
                      <span className="text-blue-600">Garçons (M)</span>
                      <span>{dashboardStats.males}</span>
                    </div>
                    <div className="h-4 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-600 transition-all duration-1000" style={{ width: `${(dashboardStats.males / (dashboardStats.totalSwimmers || 1)) * 100}%` }}></div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-black uppercase">
                      <span className="text-pink-500">Filles (F)</span>
                      <span>{dashboardStats.females}</span>
                    </div>
                    <div className="h-4 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-pink-500 transition-all duration-1000" style={{ width: `${(dashboardStats.females / (dashboardStats.totalSwimmers || 1)) * 100}%` }}></div>
                    </div>
                  </div>
                  <p className="text-[9px] text-slate-400 font-bold text-center uppercase mt-4">Proportion globale sur l'événement</p>
                </div>
              </div>

              <div className="bg-gradient-to-br from-indigo-600 to-blue-700 rounded-[3rem] p-10 text-white shadow-xl shadow-indigo-600/20 flex flex-col justify-between">
                <div className="bg-white/20 p-3 rounded-2xl w-fit"><Icons.Zap /></div>
                <div>
                  <div className="text-4xl font-black mb-1">{competition.events.length}</div>
                  <div className="text-[10px] font-black uppercase tracking-widest opacity-70">Épreuves au programme</div>
                </div>
                <button onClick={() => setActiveTab('seeding')} className="mt-6 w-full py-3 bg-white text-indigo-700 rounded-xl font-black uppercase text-[10px] hover:scale-105 transition-all shadow-lg">Gérer les départs</button>
              </div>
            </div>

            {/* MAIN CONTENT AREA */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
              {/* Configuration Column */}
              <div className="lg:col-span-2 space-y-10">
                {/* CLUB BREAKDOWN TABLE */}
                <div className="bg-white rounded-[3rem] shadow-xl border border-slate-100 overflow-hidden">
                  <div className="p-8 border-b border-slate-50 flex justify-between items-center">
                    <h3 className="text-xl font-black uppercase tracking-tighter">Statistiques par Club</h3>
                    <span className="text-[10px] bg-slate-100 px-3 py-1 rounded-full font-black text-slate-500 uppercase tracking-widest">Effectifs & Genres</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-slate-50/50 text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">
                          <th className="py-4 pl-10">Club</th>
                          <th className="py-4 text-center">Nageurs</th>
                          <th className="py-4 px-6">Ratio H/F</th>
                          <th className="py-4 pr-10 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {dashboardStats.clubBreakdown.slice(0, 8).map(club => (
                          <tr key={club.name} className="hover:bg-slate-50/50 transition-colors">
                            <td className="py-5 pl-10 font-black uppercase text-slate-700 text-sm">{club.name}</td>
                            <td className="py-5 text-center">
                              <span className="bg-slate-100 px-3 py-1 rounded-lg text-xs font-black text-slate-600">{club.total}</span>
                            </td>
                            <td className="py-5 px-6">
                              <div className="flex w-full h-2 rounded-full overflow-hidden bg-slate-100 max-w-[120px]">
                                <div className="bg-blue-600 h-full" style={{ width: `${(club.m / (club.total || 1)) * 100}%` }}></div>
                                <div className="bg-pink-500 h-full" style={{ width: `${(club.f / (club.total || 1)) * 100}%` }}></div>
                              </div>
                              <div className="flex gap-4 mt-1.5 text-[8px] font-black uppercase">
                                <span className="text-blue-500">M: {club.m}</span>
                                <span className="text-pink-400">F: {club.f}</span>
                              </div>
                            </td>
                            <td className="py-5 pr-10 text-right">
                              <button onClick={() => {
                                setSwimmerClubFilter(club.name);
                                setSearchTerm('');
                                setActiveTab('swimmers');
                              }} className="text-slate-400 hover:text-blue-600 transition-colors"><Icons.Users /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* GENERAL SETTINGS FORM */}
                <div className="bg-white rounded-[3rem] p-10 shadow-xl border border-slate-100">
                  <h3 className="text-2xl font-black uppercase tracking-tighter mb-8 flex items-center gap-4">
                    <div className="bg-amber-100 text-amber-600 p-2.5 rounded-2xl"><Icons.Settings /></div>
                    Configuration de l'événement
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-6 md:col-span-2">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-2">Nom Officiel</label>
                        <input type="text" value={competition.name} onChange={(e) => setCompetition({ ...competition, name: e.target.value })} className="w-full px-6 py-4 rounded-2xl border-2 border-slate-50 focus:border-blue-500 bg-slate-50 outline-none font-bold text-xl transition-all" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-2">Date</label>
                      <input type="date" value={competition.date || ''} onChange={(e) => setCompetition({ ...competition, date: e.target.value })} className="w-full px-6 py-4 rounded-2xl border-2 border-slate-50 focus:border-blue-500 bg-slate-50 outline-none font-bold" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-2">Lieu</label>
                      <input type="text" value={competition.location || ''} onChange={(e) => setCompetition({ ...competition, location: e.target.value })} className="w-full px-6 py-4 rounded-2xl border-2 border-slate-50 focus:border-blue-500 bg-slate-50 outline-none font-bold" />
                    </div>
                    <div className="space-y-4 md:col-span-2 pt-4">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-2">Taille du Bassin & Couloirs</label>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="flex bg-slate-100 p-2 rounded-2xl gap-2">
                          {[25, 50].map(dist => (
                            <button key={dist} onClick={() => setCompetition({ ...competition, poolDistance: dist as PoolDistance })} className={`flex-1 py-4 rounded-xl font-black transition-all ${competition.poolDistance === dist ? 'bg-white text-blue-600 shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}>
                              {dist}m
                            </button>
                          ))}
                        </div>
                        <div className="flex bg-slate-100 p-2 rounded-2xl gap-2">
                          {[6, 8].map(size => (
                            <button key={size} onClick={() => setCompetition({ ...competition, poolSize: size as PoolSize })} className={`flex-1 py-4 rounded-xl font-black transition-all ${competition.poolSize === size ? 'bg-white text-blue-600 shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}>
                              {size} Couloirs
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Side Tools Column */}
              <div className="space-y-8">
                {/* MASTER DATA BOX */}
                <div className="bg-gradient-to-br from-emerald-600 to-teal-700 rounded-[3rem] p-10 text-white shadow-xl shadow-emerald-600/20 relative overflow-hidden">
                  <div className="relative z-10">
                    <div className="bg-white/20 p-3 rounded-2xl w-fit mb-6"><Icons.Table /></div>
                    <h3 className="text-2xl font-black uppercase tracking-tighter leading-none mb-4">Importation Master Excel</h3>
                    <p className="text-emerald-50/80 font-bold text-sm mb-8">Ajoutez massivement vos nageurs et engagements.</p>
                    <button onClick={() => fileInputRef.current?.click()} className="w-full bg-white text-emerald-700 py-4 rounded-2xl font-black uppercase text-[10px] shadow-lg hover:scale-105 transition-all">
                      Importer Fichier
                    </button>
                  </div>
                </div>

                {/* BACKUP & RECOVERY */}
                <div className="bg-white rounded-[3rem] p-10 shadow-xl border border-slate-100">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6">Sécurité & Sauvegardes</h4>
                  <div className="space-y-4">
                    <button onClick={handleExportBackup} className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-blue-50 rounded-2xl border border-slate-100 transition-all group">
                      <span className="font-black text-xs uppercase text-slate-700">Exporter JSON</span>
                      <div className="text-blue-500 opacity-0 group-hover:opacity-100 transition-all"><Icons.Zap /></div>
                    </button>
                    <button onClick={() => backupInputRef.current?.click()} className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-blue-50 rounded-2xl border border-slate-100 transition-all group">
                      <span className="font-black text-xs uppercase text-slate-700">Restaurer Backup</span>
                      <div className="text-blue-500 opacity-0 group-hover:opacity-100 transition-all"><Icons.Zap /></div>
                    </button>
                    <input type="file" ref={backupInputRef} onChange={handleImportBackup} className="hidden" accept=".json" />
                  </div>
                </div>

                {/* DANGER ZONE */}
                <div className="bg-red-50 rounded-[3rem] p-10 border-2 border-dashed border-red-200">
                  <div className="text-red-500 mb-4"><Icons.Trash /></div>
                  <h4 className="text-lg font-black text-red-900 uppercase tracking-tight mb-2">Zone Critique</h4>
                  <button onClick={clearAllData} className="w-full bg-red-600 text-white py-4 rounded-2xl font-black uppercase text-[10px] shadow-lg shadow-red-600/20 hover:bg-red-700 transition-all">Effacer tout</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB CLUBS */}
        {activeTab === 'clubs' && (
          <div className="max-w-7xl mx-auto space-y-10 animate-in fade-in pb-20">
            {/* PREMIUM HEADER */}
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-8 bg-slate-900 p-10 rounded-[3rem] shadow-2xl text-white relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl -mr-32 -mt-32"></div>
              <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl -ml-32 -mb-32"></div>

              <div className="relative z-10">
                <div className="flex items-center gap-4 mb-4">
                  <div className="bg-blue-600 p-4 rounded-2xl shadow-lg shadow-blue-600/40"><Icons.Trophy /></div>
                  <h2 className="text-4xl font-black uppercase tracking-tighter">Gestion des Clubs</h2>
                </div>
                <div className="flex items-center gap-6 text-slate-400 font-bold text-sm uppercase tracking-widest">
                  <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-500"></span> {competition.clubs.length} Clubs</div>
                  <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> {competition.swimmers.length} Nageurs total</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-4 relative z-10 w-full xl:w-auto">
                <div className="relative flex-grow xl:flex-grow-0">
                  <Icons.Table />
                  <input
                    type="text"
                    placeholder="Rechercher un club..."
                    value={clubSearchTerm}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setClubSearchTerm(e.target.value)}
                    className="bg-white/10 border border-white/10 rounded-2xl py-4 pl-12 pr-6 w-full xl:w-80 font-bold text-sm focus:bg-white/20 focus:border-blue-500 outline-none transition-all backdrop-blur-md"
                  />
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 opacity-30"><Icons.Zap /></div>
                </div>
                <button onClick={() => fileInputRef.current?.click()} className="bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-4 rounded-2xl font-black uppercase text-[10px] shadow-lg shadow-emerald-600/20 transition-all flex items-center gap-3">
                  <Icons.Table /> Importer Athlètes
                </button>
              </div>
            </div>

            {/* ADD CLUB QUICK FORM */}
            <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 flex flex-col md:flex-row items-center gap-6">
              <div className="text-sm font-black uppercase tracking-widest text-slate-400 whitespace-nowrap">Nouveau Club :</div>
              <form onSubmit={(e: React.FormEvent) => { e.preventDefault(); const input = (e.target as any).clubName; const val = input.value.trim(); if (val && !competition.clubs.includes(val)) setCompetition((prev: Competition) => ({ ...prev, clubs: [...prev.clubs, val] })); input.value = ''; }} className="flex gap-3 w-full">
                <input name="clubName" type="text" placeholder="Entrez le nom du club..." className="flex-grow px-6 py-4 rounded-2xl border-2 border-slate-50 focus:border-blue-500 bg-slate-50 outline-none font-bold text-lg transition-all" required />
                <button type="submit" className="bg-slate-900 text-white px-10 py-4 rounded-2xl font-black uppercase text-[10px] shadow-xl hover:bg-slate-800 transition-all flex items-center gap-2"><Icons.Plus /> Créer</button>
              </form>
            </div>

            {/* CLUBS GRID */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {competition.clubs
                .filter((c: string) => c.toLowerCase().includes(clubSearchTerm.toLowerCase()))
                .sort()
                .map((club: string) => {
                  const clubSwimmers = competition.swimmers.filter((s: Swimmer) => s.club === club);
                  const males = clubSwimmers.filter((s: Swimmer) => s.gender === 'M').length;
                  const females = clubSwimmers.filter((s: Swimmer) => s.gender === 'F').length;

                  return (
                    <div key={club} className="group bg-white rounded-[3rem] p-8 shadow-xl hover:shadow-2xl transition-all duration-500 border border-transparent hover:border-blue-100 relative overflow-hidden flex flex-col h-full">
                      {/* Card Header */}
                      <div className="flex justify-between items-start mb-6">
                        <div className="w-16 h-16 rounded-[1.5rem] bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center text-blue-600 font-black text-xl shadow-inner uppercase">
                          {club.substring(0, 2)}
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => updateClubName(club)} className="p-2 text-slate-300 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"><Icons.Edit /></button>
                          <button onClick={() => { if (window.confirm(`Supprimer ${club} ?`)) setCompetition((prev: Competition) => ({ ...prev, clubs: prev.clubs.filter((c: string) => c !== club) })); }} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"><Icons.Trash /></button>
                        </div>
                      </div>

                      <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tighter mb-2 group-hover:text-blue-600 transition-colors leading-tight">{club}</h3>

                      {/* Stats Pill */}
                      <div className="flex items-center gap-4 mb-8">
                        <div className="bg-slate-100 px-4 py-2 rounded-xl text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                          <Icons.Users /> {clubSwimmers.length} Nageurs
                        </div>
                        <div className="flex gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-blue-500" title={`${males} Garçons`}></div>
                          <div className="w-2 h-2 rounded-full bg-pink-500" title={`${females} Filles`}></div>
                        </div>
                      </div>

                      {/* Swimmer Preview Wall */}
                      <div className="flex-grow">
                        <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4">Aperçu de l'équipe</div>
                        <div className="flex flex-wrap gap-2">
                          {clubSwimmers.slice(0, 12).map((s: Swimmer) => (
                            <button
                              key={s.id}
                              onClick={() => setSelectedSwimmerProfile(s)}
                              className={`px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase transition-all shadow-sm border border-transparent hover:border-blue-200 ${s.gender === 'M' ? 'bg-blue-50 text-blue-700' : 'bg-pink-50 text-pink-700'}`}
                            >
                              {s.lastName} {s.firstName[0]}.
                            </button>
                          ))}
                          {clubSwimmers.length > 12 && (
                            <div className="px-3 py-1.5 bg-slate-100 text-slate-400 rounded-xl text-[10px] font-black uppercase">
                              + {clubSwimmers.length - 12}
                            </div>
                          )}
                          {clubSwimmers.length === 0 && (
                            <div className="py-4 text-slate-300 italic font-medium text-xs">Aucun nageur affilié</div>
                          )}
                        </div>
                      </div>

                      {/* Footer Action */}
                      <div className="mt-8 pt-6 border-t border-slate-50">
                        <button
                          onClick={() => {
                            setSwimmerClubFilter(club);
                            setSearchTerm('');
                            setActiveTab('swimmers');
                          }}
                          className="w-full py-3 bg-slate-50 hover:bg-blue-600 hover:text-white text-slate-600 rounded-2xl font-black uppercase text-[10px] transition-all flex items-center justify-center gap-2 shadow-sm"
                        >
                          <Icons.Users /> Voir l'effectif complet
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>

            {competition.clubs.length === 0 && (
              <div className="py-32 text-center bg-white rounded-[3rem] border-2 border-dashed border-slate-200">
                <div className="text-6xl mb-6 opacity-20">🏊</div>
                <h3 className="text-xl font-black text-slate-400 uppercase tracking-widest">Aucun club dans la base</h3>
                <p className="text-slate-300 mt-2 font-bold uppercase text-[10px]">Utilisez le formulaire ou importez un fichier Excel</p>
              </div>
            )}
          </div>
        )}

        {/* TAB SWIMMERS */}
        {activeTab === 'swimmers' && (
          <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in">
            <div className="bg-slate-900 p-8 rounded-[3rem] shadow-2xl text-white flex flex-col lg:flex-row justify-between items-center gap-8 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl -mr-32 -mt-32"></div>

              <div className="relative z-10">
                <div className="flex items-center gap-4 mb-2">
                  <div className="bg-blue-600 p-3 rounded-2xl shadow-lg"><Icons.Users /></div>
                  <h2 className="text-3xl font-black uppercase tracking-tighter">Gestion des Nageurs</h2>
                </div>
                <p className="text-slate-400 font-bold text-[10px] uppercase tracking-[0.2em]">{competition.swimmers.length} Athlètes enregistrés</p>
              </div>

              <div className="flex flex-wrap justify-center lg:justify-end gap-4 w-full lg:w-auto relative z-10">
                <div className="flex bg-white/10 backdrop-blur-md p-1.5 rounded-2xl gap-2 w-full sm:w-auto border border-white/10">
                  <select
                    value={swimmerClubFilter}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSwimmerClubFilter(e.target.value)}
                    className="bg-transparent text-white px-4 py-2 font-black text-[10px] uppercase outline-none cursor-pointer border-r border-white/10"
                  >
                    <option value="Tous" className="bg-slate-800 text-white">Tous les Clubs</option>
                    {competition.clubs.sort().map((c: string) => <option key={c} value={c} className="bg-slate-800 text-white">{c}</option>)}
                  </select>
                  <div className="relative flex-grow sm:w-64">
                    <input
                      type="text"
                      placeholder="Rechercher un nom..."
                      value={searchTerm}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
                      className="bg-transparent text-white px-4 py-2 w-full font-bold text-sm outline-none placeholder:text-white/30"
                    />
                  </div>
                </div>

                <div className="flex gap-3">
                  <button onClick={() => fileInputRef.current?.click()} className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-4 rounded-2xl font-black uppercase text-[10px] shadow-lg shadow-emerald-600/20 transition-all flex items-center gap-3">
                    <Icons.Table /> {isImporting ? "Chargement..." : "Import Excel"}
                  </button>
                  <button onClick={() => setShowAddSwimmer(true)} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-4 rounded-2xl font-black uppercase text-[10px] shadow-lg shadow-blue-600/20 transition-all flex items-center gap-3">
                    <Icons.Plus /> Ajouter
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 bg-slate-50">
                    <th className="py-4 pl-6">Nom Prénom</th>
                    <th className="py-4">Club</th>
                    <th className="py-4">Catégorie</th>
                    <th className="py-4">Engagements</th>
                    <th className="py-4 pr-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredSwimmers.map((swimmer: Swimmer) => (
                    <tr key={swimmer.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-4 pl-6 font-bold uppercase">{swimmer.lastName} <span className="capitalize">{swimmer.firstName}</span></td>
                      <td className="py-4 text-slate-600 font-medium">{swimmer.club}</td>
                      <td className="py-4 text-slate-600">{getCategoryByBirthYear(swimmer.birthYear)} ({swimmer.gender})</td>
                      <td className="py-4">
                        <div className="flex flex-wrap gap-1">
                          {competition.entries.filter((e: Entry) => e.swimmerId === swimmer.id).map((e: Entry) => {
                            const ev = competition.events.find((x: CompetitionEvent) => x.id === e.eventId);
                            return ev ? <span key={e.id} className="text-[9px] bg-indigo-50 text-indigo-600 px-2 py-1 rounded font-bold uppercase border border-indigo-100">{ev.distance}m {ev.stroke}</span> : null;
                          })}
                        </div>
                      </td>
                      <td className="py-4 pr-6 text-right space-x-2">
                        <button onClick={() => setShowAddEngagement(swimmer)} className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded font-bold text-[10px] uppercase hover:bg-blue-100">Engager</button>
                        <button onClick={() => deleteSwimmer(swimmer.id)} className="px-3 py-1.5 bg-red-50 text-red-600 rounded font-bold text-[10px] uppercase hover:bg-red-100">Supprimer</button>
                      </td>
                    </tr>
                  ))}
                  {filteredSwimmers.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-slate-400 font-bold uppercase text-sm">Aucun nageur trouvé</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB SEEDING */}
        {activeTab === 'seeding' && (
          <div className="space-y-8 animate-in fade-in">
            {/* MODERN DASHBOARD HEADER */}
            <div className="flex flex-col bg-white rounded-[2.5rem] shadow-xl border border-slate-200/60 overflow-hidden no-print mb-8">
              <div className="bg-slate-900 p-8 text-white">
                <div className="flex flex-col xl:flex-row justify-between items-center gap-6">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="bg-blue-500 p-2 rounded-xl shadow-lg shadow-blue-500/30"><Icons.Zap /></div>
                      <h2 className="text-3xl font-black uppercase tracking-tighter">Gestion des Séries</h2>
                    </div>
                    <p className="text-slate-400 font-bold text-sm">Contrôle central des épreuves et du programme officiel.</p>
                  </div>
                  <div className="flex flex-wrap gap-3 justify-center bg-white/5 p-2 rounded-2xl backdrop-blur-md border border-white/10">
                    <button onClick={() => setShowAddEvent(true)} className="bg-blue-600 text-white px-5 py-3 rounded-xl font-black flex items-center gap-2 uppercase text-[10px] hover:bg-blue-500 shadow-lg shadow-blue-600/20 transition-all"><Icons.Plus /> Nouvelle Épreuve</button>
                    <button onClick={() => setEditMode(!editMode)} className={`px-5 py-3 rounded-xl font-black shadow-lg flex items-center gap-2 uppercase text-[10px] transition-all ${editMode ? 'bg-amber-500 text-white shadow-amber-500/20 ring-4 ring-amber-500/20' : 'bg-white/10 text-white hover:bg-white/20'}`}><Icons.Settings /> {editMode ? 'Quitter Édition' : 'Mode Édition'}</button>
                    <div className="w-px bg-white/10 mx-1"></div>
                    <button onClick={handlePrintSlips} className="bg-white text-slate-900 px-6 py-3 rounded-xl font-black shadow-md flex items-center gap-2 hover:bg-slate-100 uppercase text-[10px] transition-all"><SlipIcon /> Papillons</button>
                    <button onClick={handleDownloadPDF} className="bg-emerald-500 text-white px-6 py-3 rounded-xl font-black shadow-lg shadow-emerald-500/20 flex items-center gap-2 hover:bg-emerald-400 uppercase text-[10px] transition-all"><Icons.Printer /> Générer PDF</button>
                  </div>
                </div>

                {/* QUICK STATS BAR */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-8 border-t border-white/10">
                  <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Total Épreuves</div>
                    <div className="text-2xl font-black text-blue-400">{competition.events.length}</div>
                  </div>
                  <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Séries Générées</div>
                    <div className="text-2xl font-black text-indigo-400">{seededEvents.reduce((acc, se) => acc + se.heats.length, 0)}</div>
                  </div>
                  <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Couloirs Occupés</div>
                    <div className="text-2xl font-black text-emerald-400">{competition.entries.filter(e => e.heat !== null).length}</div>
                  </div>
                  <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Nageurs Engagés</div>
                    <div className="text-2xl font-black text-amber-400">{competition.swimmers.length}</div>
                  </div>
                </div>
              </div>

              <div className="p-8 space-y-6">
                {/* FILTERS & TOOLS */}
                <div className="flex flex-col lg:flex-row gap-6">
                  <div className="flex-grow grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-2">Spécialité</label>
                      <select value={seedingFilterStroke} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSeedingFilterStroke(e.target.value)} className="w-full px-4 py-3.5 rounded-xl border bg-slate-50 font-bold outline-none focus:border-blue-500 cursor-pointer text-sm transition-colors shadow-sm">
                        <option value="Tous">Toutes Nages</option>
                        {STROKES.map((s: string) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-2">Catégorie</label>
                      <select value={seedingFilterCategory} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSeedingFilterCategory(e.target.value)} className="w-full px-4 py-3.5 rounded-xl border bg-slate-50 font-bold outline-none focus:border-blue-500 cursor-pointer text-sm transition-colors shadow-sm">
                        <option value="Tous">Toutes Catégories</option>
                        {CATEGORY_ORDER.map((c: string) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-2">Genre</label>
                      <select value={seedingFilterGender} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSeedingFilterGender(e.target.value)} className="w-full px-4 py-3.5 rounded-xl border bg-slate-50 font-bold outline-none focus:border-blue-500 cursor-pointer text-sm transition-colors shadow-sm">
                        <option value="Tous">Tous Genres</option>
                        <option value="M">Messieurs</option>
                        <option value="F">Dames</option>
                        <option value="Mixte">Mixte</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-end gap-2">
                    <div className="bg-slate-100 p-1.5 rounded-xl flex gap-1 h-[50px] items-center px-3">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mr-2">PDF:</span>
                      <button onClick={() => setPdfOrientation('portrait')} className={`px-3 py-1.5 rounded-lg text-[9px] font-black transition-all ${pdfOrientation === 'portrait' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>PORTRAIT</button>
                      <button onClick={() => setPdfOrientation('landscape')} className={`px-3 py-1.5 rounded-lg text-[9px] font-black transition-all ${pdfOrientation === 'landscape' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>PAYSAGE</button>
                    </div>
                    <div className="bg-slate-100 p-1.5 rounded-xl flex gap-1 h-[50px] items-center px-3">
                      <button onClick={() => setPdfColumns(1)} className={`px-3 py-1.5 rounded-lg text-[9px] font-black transition-all ${pdfColumns === 1 ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>1 COL</button>
                      <button onClick={() => setPdfColumns(2)} className={`px-3 py-1.5 rounded-lg text-[9px] font-black transition-all ${pdfColumns === 2 ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>2 COL</button>
                    </div>
                    <button onClick={() => setShowEntryTimes(!showEntryTimes)} className={`h-[50px] px-4 rounded-xl border-2 font-bold text-[10px] uppercase transition-all flex items-center gap-2 ${showEntryTimes ? 'border-blue-100 bg-blue-50 text-blue-600' : 'border-slate-100 bg-white text-slate-400'}`}>
                      {showEntryTimes ? <Icons.Zap /> : <Icons.Settings />}
                      {showEntryTimes ? 'Temps ON' : 'Temps OFF'}
                    </button>
                  </div>
                </div>
              </div>

              {/* SORTING CONTROLS SUB-BAR */}
              <div className="bg-slate-50 px-8 py-4 border-t border-slate-100 flex items-center gap-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><Icons.Zap /> Tri des épreuves :</label>
                <select value={sortCriteria.key} onChange={(e) => setSortCriteria(prev => ({ ...prev, key: e.target.value as SortKey }))} className="px-4 py-2 bg-white border border-slate-200 rounded-lg font-bold text-[10px] uppercase outline-none focus:border-blue-500 transition-colors shadow-sm">
                  <option value="none">Standard (Par défaut)</option>
                  <option value="distance">Distance</option>
                  <option value="stroke">Nage</option>
                  <option value="category">Catégorie</option>
                  <option value="gender">Genre</option>
                </select>
                <button onClick={() => setSortCriteria(prev => ({ ...prev, direction: prev.direction === 'asc' ? 'desc' : 'asc' }))} className="p-2 bg-white border border-slate-200 rounded-lg text-slate-500 hover:text-blue-600 hover:border-blue-300 transition-all shadow-sm">
                  {sortCriteria.direction === 'asc' ? <Icons.ArrowDown /> : <Icons.ArrowUp />}
                </button>
              </div>
            </div>

            {/* VISUAL PROGRAM (Used for On-screen and standard PDF) */}
            <div className={`overflow-x-auto pb-12 pt-4 flex justify-center bg-slate-50/50 border-y border-slate-200 ${printSlipsMode ? 'hidden' : 'block'}`}>
              <div
                ref={programRef}
                className="bg-white shadow-2xl transition-all duration-300 ease-in-out print:shadow-none print:m-0"
                style={{
                  width: pdfOrientation === 'portrait' ? '210mm' : '297mm',
                  minHeight: pdfOrientation === 'portrait' ? '297mm' : '210mm',
                  padding: '15mm',
                  boxSizing: 'border-box'
                }}
              >
                <div className="text-center border-b-4 border-slate-900 pb-4 mb-8">
                  <h1 className="text-3xl font-black uppercase text-slate-900 tracking-tight">{competition.name}</h1>
                  <h2 className="text-md font-bold uppercase text-slate-500 mt-1">Programme Officiel</h2>
                </div>

                <div style={{ columnCount: pdfColumns, columnGap: '20px' }}>
                  {filteredSeededEvents.map((se, idx) => (
                    <div key={se.event.id} className="mb-10 break-inside-avoid bg-white border border-slate-200 rounded-[2rem] overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                      {/* MODERN EVENT HEADER */}
                      <div className="bg-slate-900 text-white p-6 relative overflow-hidden">
                        {/* Decorative Background Icon */}
                        <div className="absolute -right-4 -bottom-4 text-8xl opacity-10 grayscale select-none pointer-events-none">{getStrokeIcon(se.event.stroke)}</div>

                        <div className="flex justify-between items-start mb-4 relative z-10">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-3">
                              <span className="bg-blue-600 text-white text-[10px] font-black px-2 py-0.5 rounded-md">ÉPR. #{idx + 1}</span>
                              {se.event.isRelay && <span className="bg-indigo-500 text-white text-[10px] font-black uppercase px-2 py-0.5 rounded-md">Relais</span>}
                            </div>
                            <h3 className="text-2xl font-black uppercase tracking-tight leading-none mt-1">
                              {getStrokeIcon(se.event.stroke)} {se.event.distance}m {se.event.stroke}
                            </h3>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <span className="font-black text-xs uppercase bg-white/10 px-4 py-1.5 rounded-full backdrop-blur-md border border-white/10">
                              {se.event.gender === 'M' ? 'Messieurs' : se.event.gender === 'F' ? 'Dames' : 'Mixte'}
                            </span>
                            <div className="text-[10px] font-black text-blue-400 uppercase tracking-widest">{se.event.ageCategory}</div>
                          </div>
                        </div>

                        <div className="flex justify-between items-center pt-4 border-t border-white/10 relative z-10">
                          <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
                              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{se.heats.length} Séries</span>
                            </div>
                            {se.event.isRelay && <button onClick={() => setShowAddRelayEngagement(se.event.id)} className="bg-white text-slate-900 text-[9px] font-black uppercase px-3 py-1.5 rounded-lg no-print hover:bg-blue-50 transition-colors shadow-sm">+ Engager Équipe</button>}
                          </div>
                          {editMode && (
                            <div className="flex gap-1 no-print">
                              <button onClick={() => resetEventSeeding(se.event.id)} className="bg-red-500/20 hover:bg-red-500/40 p-2 rounded-lg text-white transition-colors" title="Réinitialiser l'épreuve"><Icons.Trash /></button>
                              <button onClick={() => reverseHeats(se.event.id)} className="bg-white/10 hover:bg-white/20 p-2 rounded-lg text-white transition-colors" title="Inverser l'ordre des séries"><Icons.Reverse /></button>
                              <button onClick={() => handleAddHeat(se.event.id, se.heats.length)} className="bg-white/10 hover:bg-white/20 px-3 py-1 rounded-lg text-white transition-colors font-black text-xs" title="Ajouter une série">+</button>
                              <button onClick={() => handleRemoveHeat(se.event.id, se.heats.length)} className="bg-white/10 hover:bg-white/20 px-3 py-1 rounded-lg text-white transition-colors font-black text-xs" title="Retirer une série">-</button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* MODERN HEATS DISPLAY */}
                      <div className="p-4 bg-slate-50/50">
                        {/* UNSEEDED SWIMMERS LIST (In Edit Mode) */}
                        {editMode && (() => {
                          const unseeded = competition.entries.filter(e => e.eventId === se.event.id && (!e.heat || !e.lane));
                          if (unseeded.length === 0) return null;
                          return (
                            <div className="mb-8 p-6 bg-amber-50 rounded-3xl border-2 border-dashed border-amber-200">
                              <div className="flex justify-between items-center mb-4">
                                <h4 className="text-xs font-black uppercase text-amber-700 tracking-widest flex items-center gap-2">
                                  <Icons.Users /> Nageurs en attente ({unseeded.length})
                                </h4>
                                <span className="text-[10px] font-bold text-amber-600 bg-amber-100/50 px-2 py-1 rounded-lg">Cliquez pour sélectionner puis sur un couloir</span>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {unseeded.map(e => {
                                  const swimmer = competition.swimmers.find(s => s.id === e.swimmerId);
                                  const name = e.isRelay ? e.relayClub : swimmer ? `${swimmer.lastName} ${swimmer.firstName[0]}.` : "Inconnu";
                                  return (
                                    <button
                                      key={e.id}
                                      onClick={() => setSelectedEntryId(selectedEntryId === e.id ? null : e.id)}
                                      className={`px-4 py-2.5 rounded-xl border-2 transition-all text-xs font-bold uppercase tracking-tight flex items-center gap-2 ${selectedEntryId === e.id ? 'bg-amber-500 text-white border-amber-600 shadow-lg' : 'bg-white text-amber-900 border-amber-100 hover:border-amber-300 shadow-sm'}`}
                                    >
                                      {name} <span className="opacity-50 font-mono">{e.entryTime}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}
                        {se.heats.map(heat => {
                          const status = getHeatStatus(heat.assignments);
                          return (
                            <div key={heat.heatNumber} className="mb-6 last:mb-0 break-inside-avoid bg-white border border-slate-200 rounded-[1.5rem] overflow-hidden shadow-sm hover:border-blue-200 transition-colors">
                              <div className="flex justify-between items-center bg-slate-50 px-4 py-3 border-b border-slate-200">
                                <div className="flex items-center gap-3">
                                  <span className="text-xs font-black uppercase text-slate-800 tracking-tighter">Série {heat.heatNumber}</span>
                                  <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md border ${status.color}`}>{status.label}</span>
                                </div>
                                {editMode && (
                                  <div className="flex gap-2 no-print items-center text-slate-400">
                                    <button onClick={() => moveHeat(se.event.id, heat.heatNumber, 'up')} className="hover:text-blue-600 transition-colors bg-white p-1 rounded border border-slate-200 shadow-sm"><Icons.ArrowUp /></button>
                                    <button onClick={() => moveHeat(se.event.id, heat.heatNumber, 'down')} className="hover:text-blue-600 transition-colors bg-white p-1 rounded border border-slate-200 shadow-sm"><Icons.ArrowDown /></button>
                                  </div>
                                )}
                              </div>
                              <table className="w-full text-xs">
                                <tbody className="divide-y divide-slate-100">
                                  {heat.assignments.map(assign => (
                                    <tr key={assign.lane} onClick={() => handleSlotClick(se.event.id, heat.heatNumber, assign.lane)} className={`transition-all ${editMode ? 'cursor-pointer' : ''} ${selectedSlot?.eventId === se.event.id && selectedSlot.heat === heat.heatNumber && selectedSlot.lane === assign.lane ? 'bg-blue-50 border-y-2 border-blue-200' : assign.swimmer || assign.entry?.isRelay ? 'hover:bg-slate-50' : 'bg-slate-50/30 text-slate-400 opacity-60'}`}>
                                      <td className={`font-black text-center w-10 py-3 border-r border-slate-100 ${assign.swimmer || assign.entry?.isRelay ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-300'}`}>{assign.lane}</td>
                                      <td className="uppercase font-black truncate px-4 py-3">
                                        {assign.entry?.isRelay ? (
                                          <span className="text-indigo-700 flex items-center gap-2"><span className="text-indigo-400">🛡️</span> {assign.entry.relayClub}</span>
                                        ) : assign.swimmer ? (
                                          <div className="flex flex-col">
                                            <span className="text-slate-800">{assign.swimmer.lastName} <span className="capitalize text-slate-500 font-bold">{assign.swimmer.firstName}</span></span>
                                            <span className="text-[9px] font-bold text-slate-400">{assign.swimmer.club}</span>
                                          </div>
                                        ) : (
                                          <span className="text-slate-200 italic flex items-center gap-2 select-none">
                                            <div className="w-1.5 h-1.5 rounded-full bg-slate-100"></div> Vide
                                          </span>
                                        )}
                                      </td>
                                      <td className="text-right px-4 py-3">
                                        <div className="flex items-center justify-end gap-3">
                                          {showEntryTimes && (
                                            <div className="flex items-center gap-1.5 group/time">
                                              <span className="font-mono font-bold text-blue-500/60 bg-blue-50/50 px-2 py-1 rounded text-[10px]">
                                                {assign.entry?.entryTime || '--:--,--'}
                                              </span>
                                              {editMode && assign.entry && (
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    const nt = window.prompt("Nouveau temps d'engagement (ex: 01:25,40):", assign.entry!.entryTime);
                                                    if (nt !== null) handleUpdateEntryTime(assign.entry!.id, nt);
                                                  }}
                                                  className="text-slate-300 hover:text-blue-500 transition-colors p-0.5 opacity-0 group-hover/time:opacity-100"
                                                  title="Modifier le temps d'engagement"
                                                >
                                                  <Icons.Edit />
                                                </button>
                                              )}
                                            </div>
                                          )}
                                          {editMode && (assign.swimmer || assign.entry?.isRelay) && (
                                            <button
                                              onClick={(e) => { e.stopPropagation(); handleUnseedEntry(assign.entry!.id); }}
                                              className="text-slate-300 hover:text-red-500 transition-colors p-1"
                                              title="Retirer de la série"
                                            >
                                              <Icons.Trash />
                                            </button>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {filteredSeededEvents.length === 0 && (
                    <div className="text-center py-16 text-slate-400 font-black uppercase text-sm bg-slate-100/50 rounded-[2rem] border border-dashed border-slate-300 col-span-full shadow-inner">
                      <div className="text-4xl mb-4">🏊</div>
                      Aucune épreuve ne correspond aux filtres
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* FLOATING EDITOR STATUS (Only in Edit Mode) */}
            {editMode && (
              <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur-xl border border-white/20 px-8 py-4 rounded-[2rem] shadow-2xl z-[100] flex items-center gap-6 animate-in slide-in-from-bottom-10 no-print">
                <div className="flex items-center gap-3 pr-6 border-r border-white/10">
                  <div className="w-3 h-3 rounded-full bg-amber-500 animate-pulse"></div>
                  <span className="text-[10px] font-black text-white uppercase tracking-widest">Mode Édition Actif</span>
                </div>
                <div className="flex items-center gap-4">
                  {selectedEntryId ? (
                    <>
                      <span className="text-[10px] font-bold text-amber-400 uppercase">Nageur sélectionné :</span>
                      <span className="bg-amber-500 text-white px-3 py-1 rounded-lg font-black text-[10px]">EN ATTENTE DE PLACEMENT</span>
                      <button onClick={() => setSelectedEntryId(null)} className="text-white/50 hover:text-white transition-colors text-xs font-black uppercase tracking-tight">Annuler</button>
                    </>
                  ) : selectedSlot ? (
                    <>
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Emplacement sélectionné :</span>
                      <span className="bg-blue-600 text-white px-3 py-1 rounded-lg font-black text-[10px]">SÉRIE {selectedSlot.heat} • COULOIR {selectedSlot.lane}</span>
                      <button onClick={() => setSelectedSlot(null)} className="text-white/50 hover:text-white transition-colors text-xs font-black uppercase tracking-tight">Annuler</button>
                    </>
                  ) : (
                    <span className="text-[10px] font-bold text-slate-400 uppercase italic">Cliquez sur un couloir pour le déplacer ou l'échanger, ou sélectionnez un nageur en attente</span>
                  )}
                </div>
              </div>
            )}
            {/* TIMING SLIPS GRID (Print-Only or Manual Preview) */}
            <div className={`bg-white slips-grid ${printSlipsMode ? 'grid grid-cols-2 lg:grid-cols-3 gap-6 p-8' : 'hidden'}`}>
              {timingSlips.map(slip => (
                <div key={slip.id} className="page-break-avoid border-[3px] border-slate-900 rounded-[2rem] p-6 relative overflow-hidden bg-white shadow-md flex flex-col min-h-[85mm]">
                  {/* DECORATIVE WATERMARK */}
                  <div className="absolute -right-6 -top-6 text-[10rem] opacity-[0.03] grayscale select-none pointer-events-none font-black">
                    {slip.laneNum}
                  </div>

                  {/* HEADER SECTION */}
                  <div className="flex justify-between items-start mb-6 relative z-10 border-b-2 border-slate-100 pb-4">
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <span className="bg-slate-900 text-white text-xs font-black uppercase px-3 py-1 rounded-lg">Épreuve {slip.eventNum}</span>
                        <span className="text-slate-400 font-black text-xs uppercase tracking-widest">{slip.eventDetails}</span>
                      </div>
                      <div className="font-black uppercase text-xl leading-tight text-slate-800 tracking-tighter">{slip.eventName}</div>
                    </div>
                    <div className="flex gap-2">
                      <div className="bg-slate-100 px-4 py-2 rounded-2xl text-center">
                        <div className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Série</div>
                        <div className="text-2xl font-black text-slate-900 leading-none">{slip.heatNum}</div>
                      </div>
                      <div className="bg-blue-600 text-white px-5 py-2 rounded-2xl text-center shadow-lg shadow-blue-600/20">
                        <div className="text-[8px] font-black text-white/70 uppercase tracking-widest">Couloir</div>
                        <div className="text-3xl font-black leading-none">{slip.laneNum}</div>
                      </div>
                    </div>
                  </div>

                  {/* SWIMMER INFO */}
                  <div className="mb-6 relative z-10">
                    <div className="text-[9px] font-black text-blue-500 uppercase tracking-[0.2em] mb-1">Concurrent</div>
                    <div className="font-black uppercase text-2xl leading-none truncate text-slate-900 mb-1">{slip.swimmerName}</div>
                    <div className="flex justify-between items-center">
                      <div className="text-sm font-bold text-slate-500 uppercase">{slip.club}</div>
                      <div className="text-[10px] font-black text-slate-400 uppercase">Eng: <span className="font-mono text-slate-600">{slip.entryTime}</span></div>
                    </div>
                  </div>

                  {/* TIMING GRID */}
                  <div className="flex-grow space-y-4 relative z-10">
                    <div className="grid grid-cols-3 gap-3">
                      {[1, 2, 3].map(i => (
                        <div key={i} className="border-2 border-slate-200 rounded-2xl p-2 h-16 flex flex-col justify-between bg-slate-50/50">
                          <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Chrono {i}</span>
                          <div className="border-b border-slate-200 w-full mb-1"></div>
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-5 gap-4">
                      <div className="col-span-3 border-[3px] border-blue-600 rounded-2xl p-3 h-20 flex flex-col justify-between bg-blue-50/30">
                        <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse"></div>
                          Temps Officiel
                        </span>
                        <div className="font-mono text-3xl font-black text-blue-200 tracking-[0.2em] text-center mb-1">
                          __:__,__
                        </div>
                      </div>
                      <div className="col-span-2 border-2 border-slate-200 rounded-2xl p-3 h-20 flex flex-col justify-between italic text-slate-300">
                        <span className="text-[8px] font-black text-slate-400 uppercase not-italic tracking-widest">Observations</span>
                      </div>
                    </div>
                  </div>

                  {/* FOOTER / SIGNATURE */}
                  <div className="mt-6 pt-4 border-t border-dashed border-slate-200 flex justify-between items-end">
                    <div className="text-[8px] font-bold text-slate-300 uppercase">Généré par SwimManager Pro</div>
                    <div className="flex flex-col items-center">
                      <div className="w-32 border-b border-slate-900 mb-1"></div>
                      <span className="text-[9px] font-black text-slate-900 uppercase tracking-widest">Signature Juge</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}


        {/* TAB RESULTS (Minimalist implementation for context) */}
        {activeTab === 'results' && (
          <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in">
            <div className="bg-white p-6 rounded-3xl flex justify-between items-center shadow-sm">
              <h2 className="text-2xl font-black uppercase">Résultats Officiels</h2>
              <div className="flex gap-3"><button onClick={handleExportResultsExcel} className="bg-emerald-600 text-white px-6 py-2 rounded-xl font-bold uppercase text-xs">Excel</button></div>
            </div>

            {/* FILTERS */}
            <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-2">Nage</label>
                <select value={resultFilterStroke} onChange={e => setResultFilterStroke(e.target.value)} className="w-full px-4 py-3 rounded-xl border bg-slate-50 font-bold outline-none focus:border-blue-500 cursor-pointer">
                  <option value="Tous">Toutes Nages</option>
                  {STROKES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-2">Catégorie</label>
                <select value={resultFilterCategory} onChange={e => setResultFilterCategory(e.target.value)} className="w-full px-4 py-3 rounded-xl border bg-slate-50 font-bold outline-none focus:border-blue-500 cursor-pointer">
                  <option value="Tous">Toutes Catégories</option>
                  {CATEGORY_ORDER.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-2">Genre</label>
                <select value={resultFilterGender} onChange={e => setResultFilterGender(e.target.value)} className="w-full px-4 py-3 rounded-xl border bg-slate-50 font-bold outline-none focus:border-blue-500 cursor-pointer">
                  <option value="Tous">Tous Genres</option>
                  <option value="M">Messieurs</option>
                  <option value="F">Dames</option>
                  <option value="Mixte">Mixte</option>
                </select>
              </div>
            </div>

            {/* CLUB RANKINGS */}
            <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
              <div className="flex items-center gap-3 mb-8">
                <div className="p-2.5 bg-blue-100 text-blue-600 rounded-xl shadow-inner"><TrophyIcon color="currentColor" /></div>
                <h2 className="text-2xl font-black uppercase tracking-tight text-slate-800">Classement des Clubs</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                      <th className="pb-4 pl-4 w-16">Rang</th>
                      <th className="pb-4">Club</th>
                      <th className="pb-4 text-center">🥇 Or</th>
                      <th className="pb-4 text-center">🥈 Arg</th>
                      <th className="pb-4 text-center">🥉 Brz</th>
                      <th className="pb-4 text-right pr-6">Total PTS</th>
                    </tr>
                    {/* Barème FINA: 1er=20, 2e=17, 3e=16, 4e=15... Relais x2 */}
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {clubScores.map((club, idx) => (
                      <tr key={club.name} className={`group transition-colors ${idx === 0 ? "bg-amber-50/30" : "hover:bg-slate-50/50"}`}>
                        <td className="py-5 pl-4 flex items-center gap-2">
                          <span className={`w-8 h-8 flex items-center justify-center rounded-lg font-black ${idx === 0 ? 'bg-amber-400 text-white shadow-lg shadow-amber-200' : idx === 1 ? 'bg-slate-300 text-white' : idx === 2 ? 'bg-orange-300 text-white' : 'text-slate-400'}`}>
                            {idx + 1}
                          </span>
                          {idx === 0 && <span className="animate-bounce">🏆</span>}
                        </td>
                        <td className="py-5">
                          <div className="font-black text-slate-700 uppercase tracking-tight">{club.name}</div>
                        </td>
                        <td className="py-5 text-center">
                          <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-amber-50 text-amber-600 font-black border border-amber-100">{club.gold}</span>
                        </td>
                        <td className="py-5 text-center">
                          <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-slate-50 text-slate-500 font-black border border-slate-100">{club.silver}</span>
                        </td>
                        <td className="py-5 text-center">
                          <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-orange-50 text-orange-600 font-black border border-orange-100">{club.bronze}</span>
                        </td>
                        <td className="py-5 text-right pr-6">
                          <div className="flex flex-col items-end">
                            <span className="text-3xl font-black text-blue-900 leading-none">{club.total}</span>
                            <span className="text-[9px] font-bold text-blue-400 uppercase tracking-widest mt-1">Points</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {clubScores.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-20 text-center">
                          <div className="flex flex-col items-center opacity-30">
                            <div className="mb-4 scale-150"><TrophyIcon color="#94a3b8" /></div>
                            <span className="text-slate-500 font-black uppercase text-sm tracking-widest">Aucun point marqué</span>
                            <p className="text-slate-400 text-xs font-bold mt-2">Saisissez les résultats pour voir le classement</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid gap-6">
              {seededEvents
                .filter(se => resultFilterStroke === 'Tous' || se.event.stroke === resultFilterStroke)
                .filter(se => resultFilterCategory === 'Tous' || se.event.ageCategory === resultFilterCategory)
                .filter(se => resultFilterGender === 'Tous' || se.event.gender === resultFilterGender)
                .map(se => (
                  <div key={se.event.id} className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
                    <div className="flex justify-between items-end mb-4 border-b border-slate-100 pb-3">
                      <div className="flex items-center gap-3">
                        <h3 className="font-black uppercase text-sm text-slate-800">{se.event.distance}m {se.event.stroke} <span className="text-slate-400 mx-1">•</span> {se.event.gender === 'M' ? 'Messieurs' : se.event.gender === 'F' ? 'Dames' : 'Mixte'} <span className="text-slate-400 mx-1">•</span> {se.event.ageCategory}</h3>
                        {se.event.isRelay && <span className="text-[9px] font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md border border-indigo-100 uppercase">Relais</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        {se.event.isRelay && <button onClick={() => setShowAddRelayEngagement(se.event.id)} className="text-[10px] font-bold text-indigo-600 uppercase bg-indigo-50 px-3 py-1 rounded-md hover:bg-indigo-100 transition-colors border border-indigo-100">+ Club</button>}
                        <span className="text-[10px] font-bold text-blue-500 uppercase bg-blue-50 px-2 py-1 rounded-md">{se.heats.flatMap(h => h.assignments).filter(a => a.entry).length} {se.event.isRelay ? 'équipes' : 'nageurs'}</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {[...se.heats.flatMap(h => h.assignments).filter(a => a.entry && (a.swimmer || a.entry?.isRelay))]
                        .sort((a, b) => {
                          if (a.entry?.rank && b.entry?.rank) return a.entry.rank - b.entry.rank;
                          if (a.entry?.rank) return -1;
                          if (b.entry?.rank) return 1;
                          return 0;
                        })
                        .map(assign => (
                          <div key={assign.entry?.id} className={`flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 rounded-xl border transition-all duration-300 ${assign.entry?.rank === 1 ? 'bg-amber-50/50 border-amber-200' : assign.entry?.rank === 2 ? 'bg-slate-50 border-slate-200' : assign.entry?.rank === 3 ? 'bg-orange-50/50 border-orange-200' : 'bg-white border-slate-100 hover:border-blue-200 shadow-sm'}`}>

                            <div className="flex items-center gap-3 w-full sm:w-1/2 mb-2 sm:mb-0">
                              <div className={`w-10 h-10 shrink-0 flex items-center justify-center font-black rounded-xl ${assign.entry?.rank === 1 ? 'bg-amber-100 text-amber-600 shadow-inner' : assign.entry?.rank === 2 ? 'bg-slate-200 text-slate-600 shadow-inner' : assign.entry?.rank === 3 ? 'bg-orange-200 text-orange-700 shadow-inner' : 'bg-slate-50 text-slate-400 border border-slate-100'}`}>
                                {assign.entry?.rank === 1 ? <span className="text-xl drop-shadow-sm">🥇</span> :
                                  assign.entry?.rank === 2 ? <span className="text-xl drop-shadow-sm">🥈</span> :
                                    assign.entry?.rank === 3 ? <span className="text-xl drop-shadow-sm">🥉</span> :
                                      assign.entry?.rank || '-'}
                              </div>
                              <div>
                                <div className="font-black uppercase text-sm leading-tight text-slate-800">
                                  {assign.entry?.isRelay
                                    ? <><span className="text-indigo-600">🏊‍♂️ RELAIS</span> {assign.entry?.relayClub}</>
                                    : <>{assign.swimmer?.lastName} <span className="capitalize text-slate-600">{assign.swimmer?.firstName}</span></>
                                  }
                                </div>
                                <div className="text-[10px] font-bold text-slate-400 uppercase mt-0.5">
                                  {assign.entry?.isRelay ? assign.entry?.relayClub : assign.swimmer?.club}
                                  <span className="opacity-40 mx-1">•</span> Eng: {assign.entry?.entryTime}
                                  {assign.entry?.points ? <span className="ml-2 text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{assign.entry.points} pts</span> : null}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 w-full sm:w-auto">
                              <div className="relative w-full sm:w-32">
                                <input type="text" defaultValue={assign.entry?.resultTime || ''} onBlur={(e) => handleUpdateResult(assign.entry!.id, e.target.value)} placeholder="00:00,00" className={`w-full px-3 py-2 text-sm font-mono font-bold rounded-lg border outline-none focus:ring-2 focus:ring-blue-500 transition-all text-center sm:text-right ${resultErrors[assign.entry!.id] ? 'border-red-500 bg-red-50 text-red-700' : 'border-slate-200 bg-slate-50 text-blue-900 focus:bg-white focus:shadow-md'}`} />
                                {resultErrors[assign.entry!.id] && <span className="text-red-500 text-[9px] font-bold absolute -bottom-4 right-0">{resultErrors[assign.entry!.id]}</span>}
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                ))}

              {seededEvents
                .filter(se => resultFilterStroke === 'Tous' || se.event.stroke === resultFilterStroke)
                .filter(se => resultFilterCategory === 'Tous' || se.event.ageCategory === resultFilterCategory)
                .filter(se => resultFilterGender === 'Tous' || se.event.gender === resultFilterGender)
                .length === 0 && (
                  <div className="text-center py-12 text-slate-400 font-bold uppercase text-sm bg-slate-100/50 rounded-3xl border border-dashed border-slate-200">
                    Aucune épreuve ne correspond à ces critères
                  </div>
                )}
            </div>
          </div>
        )}

      </main>

      {/* MODAL SWIMMERS & EVENTS (Raccourcis pour rester complet) */}
      {showAddSwimmer && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-6 z-[100]"><div className="bg-white rounded-[2rem] p-8 w-full max-w-lg shadow-2xl">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-2xl font-black uppercase text-slate-800">Nouveau Nageur</h3>
            <div className="bg-blue-100 text-blue-600 p-2 rounded-xl"><Icons.Users /></div>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.target as HTMLFormElement); addSwimmer({ lastName: f.get('lastName') as string, firstName: f.get('firstName') as string, club: f.get('club') as string, birthYear: parseInt(f.get('birthYear') as string), gender: f.get('gender') as 'M' | 'F' }); }} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Nom</label><input name="lastName" placeholder="Ex: DUPONT" required className="w-full px-4 py-3 rounded-xl border bg-slate-50 font-bold uppercase outline-none focus:border-blue-500 transition-colors" /></div>
              <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Prénom</label><input name="firstName" placeholder="Ex: Jean" required className="w-full px-4 py-3 rounded-xl border bg-slate-50 font-bold outline-none focus:border-blue-500 transition-colors" /></div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Club d'appartenance</label>
              <select name="club" required className="w-full px-4 py-3 rounded-xl border bg-slate-50 font-bold cursor-pointer outline-none focus:border-blue-500 transition-colors">
                {competition.clubs.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Année Naiss.</label><input name="birthYear" type="number" defaultValue={newSwimmerYear} className="w-full px-4 py-3 rounded-xl border bg-slate-50 font-bold text-center outline-none focus:border-blue-500 transition-colors" /></div>
              <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Genre</label><select name="gender" className="w-full px-4 py-3 rounded-xl border bg-slate-50 font-bold cursor-pointer outline-none focus:border-blue-500 transition-colors"><option value="M">Masculin (M)</option><option value="F">Féminin (F)</option></select></div>
            </div>
            <div className="flex gap-4 pt-4"><button type="button" onClick={() => setShowAddSwimmer(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold uppercase text-xs hover:bg-slate-200 transition-colors">Annuler</button><button type="submit" className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold uppercase text-xs hover:bg-blue-700 shadow-md transition-colors">Ajouter Nageur</button></div>
          </form>
        </div></div>
      )}

      {showAddEvent && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-6 z-[100]"><div className="bg-white rounded-[2rem] p-8 w-full max-w-lg shadow-2xl">
          <h3 className="text-2xl font-black mb-6 uppercase">Nouvelle Épreuve</h3>
          <form onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.target as HTMLFormElement);
            const stroke = f.get('stroke') as any;
            const isRelay = stroke.startsWith('Relais');
            createEvent({
              distance: parseInt(f.get('distance') as string),
              stroke,
              gender: f.get('gender') as 'M' | 'F' | 'Mixte',
              ageCategory: f.get('category') as string,
              isRelay
            });
          }} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-black text-slate-400">Dist.</label>
                <select name="distance" className="w-full px-4 py-3 rounded-xl border bg-slate-50 font-bold">
                  <option value="50">50m</option>
                  <option value="100">100m</option>
                  <option value="200">200m</option>
                  <option value="400">400m</option>
                  <option value="800">800m</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400">Nage</label>
                <select name="stroke" className="w-full px-4 py-3 rounded-xl border bg-slate-50 font-bold">
                  <optgroup label="Individuel">
                    {STROKES.map(s => <option key={s} value={s}>{s}</option>)}
                  </optgroup>
                  <optgroup label="Relais">
                    <option value="Relais Nage Libre">Relais Nage Libre</option>
                    <option value="Relais 4 Nages">Relais 4 Nages</option>
                  </optgroup>
                </select>
              </div>
            </div>
            <select name="category" className="w-full px-4 py-3 rounded-xl border bg-slate-50 font-bold">{CATEGORY_ORDER.map(c => <option key={c} value={c}>{c}</option>)}</select>
            <select name="gender" className="w-full px-4 py-3 rounded-xl border bg-slate-50 font-bold"><option value="M">Messieurs</option><option value="F">Dames</option><option value="Mixte">Mixte</option></select>
            <div className="flex gap-4 pt-4"><button type="button" onClick={() => setShowAddEvent(false)} className="flex-1 py-3 bg-slate-100 rounded-xl font-bold uppercase text-xs">Annuler</button><button type="submit" className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold uppercase text-xs">Créer</button></div>
          </form>
        </div></div>
      )}

      {showAddEngagement && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-6 z-[100]"><div className="bg-white rounded-[2rem] p-8 w-full max-w-lg shadow-2xl">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-2xl font-black uppercase text-slate-800">Engager un nageur</h3>
            <div className="bg-amber-100 text-amber-600 p-2 rounded-xl"><Icons.Zap /></div>
          </div>
          <div className="mb-6 flex gap-3 items-center">
            <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center font-black text-lg text-slate-400">{showAddEngagement.firstName[0]}{showAddEngagement.lastName[0]}</div>
            <div>
              <div className="font-black uppercase text-lg leading-tight">{showAddEngagement.lastName} {showAddEngagement.firstName}</div>
              <div className="text-xs font-bold text-slate-500 uppercase">{showAddEngagement.club} • {getCategoryByBirthYear(showAddEngagement.birthYear)}</div>
            </div>
          </div>
          <form onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.target as HTMLFormElement);
            const time = f.get('time') as string;
            if (!isValidTimeFormat(time)) return alert("Format MM:SS,00 (ex: 01:05,23)");

            const distance = parseInt(f.get('distance') as string);
            const stroke = f.get('stroke') as Stroke;
            const swimmerCategory = getCategoryByBirthYear(showAddEngagement.birthYear);
            const eventId = `ev-${stroke}-${distance}-${showAddEngagement.gender}-${swimmerCategory}`.replace(/\s+/g, '-');

            setCompetition(prev => {
              let newEvents = [...prev.events];
              if (!newEvents.some(ev => ev.id === eventId)) {
                newEvents.push({
                  id: eventId,
                  distance,
                  stroke,
                  gender: showAddEngagement.gender,
                  ageCategory: swimmerCategory
                });
              }

              // Check if already engaged
              if (prev.entries.some(en => en.swimmerId === showAddEngagement.id && en.eventId === eventId)) {
                alert("Ce nageur est déjà engagé sur cette épreuve.");
                return prev;
              }

              return {
                ...prev,
                events: newEvents,
                entries: [
                  ...prev.entries,
                  {
                    id: crypto.randomUUID(),
                    swimmerId: showAddEngagement.id,
                    eventId: eventId,
                    entryTime: formatMsToTime(parseTimeToMs(time)),
                    entryTimeMs: parseTimeToMs(time),
                    heat: null,
                    lane: null
                  }
                ]
              };
            });
            setShowAddEngagement(null);
          }} className="space-y-5">

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Distance</label>
                <select name="distance" className="w-full px-4 py-3 rounded-xl border bg-slate-50 font-bold cursor-pointer outline-none focus:border-blue-500">
                  <option value="25">25m</option>
                  <option value="50">50m</option>
                  <option value="100">100m</option>
                  <option value="200">200m</option>
                  <option value="400">400m</option>
                  <option value="800">800m</option>
                  <option value="1500">1500m</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Nage</label>
                <select name="stroke" className="w-full px-4 py-3 rounded-xl border bg-slate-50 font-bold cursor-pointer outline-none focus:border-blue-500">
                  {STROKES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Temps d'engagement</label>
              <input name="time" placeholder="00:00,00 (ou NT)" required className="w-full px-4 py-3 rounded-xl border bg-slate-50 font-mono font-bold text-lg outline-none focus:border-blue-500 text-center" />
              <p className="text-[9px] text-slate-400 font-bold text-center mt-1">Exemples: 01:05,23 ou 59,50 ou NT</p>
            </div>

            <div className="flex gap-4 pt-4">
              <button type="button" onClick={() => setShowAddEngagement(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold uppercase text-xs hover:bg-slate-200 transition-colors">Annuler</button>
              <button type="submit" className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold uppercase text-xs hover:bg-emerald-700 shadow-md transition-colors">Confirmer</button>
            </div>
          </form>
        </div></div>
      )}
      {/* MODAL RELAY ENGAGEMENT */}
      {showAddRelayEngagement && (() => {
        const relayEvent = competition.events.find(e => e.id === showAddRelayEngagement);
        if (!relayEvent) return null;
        return (
          <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-6 z-[100]"><div className="bg-white rounded-[2rem] p-8 w-full max-w-lg shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-2xl font-black uppercase text-slate-800">Engager un Relais</h3>
              <div className="bg-indigo-100 text-indigo-600 p-2 rounded-xl"><Icons.Users /></div>
            </div>
            <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100 mb-6">
              <div className="font-black uppercase text-sm text-indigo-800">{relayEvent.distance}m {relayEvent.stroke}</div>
              <div className="text-xs font-bold text-indigo-500 uppercase mt-1">{relayEvent.gender === 'M' ? 'Messieurs' : relayEvent.gender === 'F' ? 'Dames' : 'Mixte'} • {relayEvent.ageCategory}</div>
            </div>
            <form onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.target as HTMLFormElement);
              const club = f.get('club') as string;
              const time = f.get('time') as string;
              if (!isValidTimeFormat(time)) return alert("Format MM:SS,00 (ex: 04:15,00)");

              // Check if club already engaged
              if (competition.entries.some(en => en.isRelay && en.relayClub === club && en.eventId === relayEvent.id)) {
                alert("Ce club est déjà engagé sur cette épreuve de relais.");
                return;
              }

              setCompetition(prev => ({
                ...prev,
                entries: [
                  ...prev.entries,
                  {
                    id: crypto.randomUUID(),
                    swimmerId: `relay-${club}`,
                    eventId: relayEvent.id,
                    entryTime: formatMsToTime(parseTimeToMs(time)),
                    entryTimeMs: parseTimeToMs(time),
                    heat: null,
                    lane: null,
                    isRelay: true,
                    relayClub: club
                  }
                ]
              }));
              setShowAddRelayEngagement(null);
            }} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Club</label>
                <select name="club" required className="w-full px-4 py-3 rounded-xl border bg-slate-50 font-bold cursor-pointer outline-none focus:border-blue-500 transition-colors">
                  {competition.clubs.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Temps d'engagement du relais</label>
                <input name="time" placeholder="04:15,00 (ou NT)" required className="w-full px-4 py-3 rounded-xl border bg-slate-50 font-mono font-bold text-lg outline-none focus:border-blue-500 text-center transition-colors" />
                <p className="text-[9px] text-slate-400 font-bold text-center mt-1">Exemples: 04:15,00 ou NT</p>
              </div>
              <div className="flex gap-4 pt-4">
                <button type="button" onClick={() => setShowAddRelayEngagement(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold uppercase text-xs hover:bg-slate-200 transition-colors">Annuler</button>
                <button type="submit" className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold uppercase text-xs hover:bg-indigo-700 shadow-md transition-colors">Engager Relais</button>
              </div>
            </form>
          </div></div>
        );
      })()}

      {/* MODAL FICHE NAGEUR (Profile) */}
      {selectedSwimmerProfile && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-6 z-[120] animate-in fade-in duration-300">
          <div className="bg-white rounded-[3rem] w-full max-w-2xl shadow-2xl overflow-hidden border border-white/20 animate-in zoom-in-95 duration-300">
            {/* Header with gradient background */}
            <div className="bg-gradient-to-br from-slate-900 to-blue-900 p-10 text-white relative">
              <button onClick={() => setSelectedSwimmerProfile(null)} className="absolute top-6 right-6 p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors"><Icons.Zap /></button>

              <div className="flex items-center gap-8">
                <div className="w-24 h-24 bg-white/10 rounded-[2rem] flex items-center justify-center text-4xl font-black border border-white/20 backdrop-blur-md">
                  {selectedSwimmerProfile.lastName[0]}{selectedSwimmerProfile.firstName[0]}
                </div>
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-[10px] font-black uppercase tracking-widest bg-blue-500 px-2 py-1 rounded shadow-sm">{getCategoryByBirthYear(selectedSwimmerProfile.birthYear)}</span>
                    <span className="text-[10px] font-black uppercase tracking-widest bg-white/10 px-2 py-1 rounded border border-white/10">{selectedSwimmerProfile.gender === 'M' ? 'Messieurs' : 'Dames'}</span>
                  </div>
                  <h3 className="text-4xl font-black uppercase tracking-tighter leading-none">{selectedSwimmerProfile.lastName} <span className="text-blue-400">{selectedSwimmerProfile.firstName}</span></h3>
                  <div className="text-slate-400 font-bold uppercase tracking-widest text-xs mt-3 flex items-center gap-2">
                    <Icons.Trophy /> {selectedSwimmerProfile.club}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-10 space-y-8 max-h-[60vh] overflow-y-auto custom-scrollbar">
              {/* Quick Stats Grid */}
              <div className="grid grid-cols-3 gap-6">
                <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
                  <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Épreuves</div>
                  <div className="text-2xl font-black text-slate-800">{competition.entries.filter(e => e.swimmerId === selectedSwimmerProfile.id).length}</div>
                </div>
                <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
                  <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Points</div>
                  <div className="text-2xl font-black text-blue-600">{competition.entries.filter(e => e.swimmerId === selectedSwimmerProfile.id).reduce((acc, e) => acc + (e.points || 0), 0)}</div>
                </div>
                <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
                  <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Meilleur Rang</div>
                  <div className="text-2xl font-black text-emerald-600">
                    {Math.min(...competition.entries.filter(e => e.swimmerId === selectedSwimmerProfile.id && e.rank).map(e => e.rank as number)) || '-'}
                  </div>
                </div>
              </div>

              {/* Detailed Entries List */}
              <div className="space-y-4">
                <h4 className="text-sm font-black uppercase tracking-widest text-slate-800 border-b pb-2 flex items-center gap-2"><Icons.Zap /> Engagements & Résultats</h4>
                <div className="space-y-3">
                  {competition.entries.filter(e => e.swimmerId === selectedSwimmerProfile.id).length === 0 && (
                    <div className="text-center py-8 text-slate-300 font-bold uppercase text-xs">Aucun engagement pour ce nageur</div>
                  )}
                  {competition.entries.filter(e => e.swimmerId === selectedSwimmerProfile.id).map(entry => {
                    const event = competition.events.find(ev => ev.id === entry.eventId);
                    if (!event) return null;
                    return (
                      <div key={entry.id} className="bg-white border border-slate-100 rounded-2xl p-4 flex justify-between items-center hover:shadow-md transition-all">
                        <div>
                          <div className="font-black uppercase text-slate-800">{event.distance}m {event.stroke}</div>
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Engagé en : {entry.entryTime}</div>
                        </div>
                        <div className="flex items-center gap-6">
                          <div className="text-right">
                            <div className="text-sm font-mono font-black text-blue-600">{entry.resultTime || '--:--,--'}</div>
                            <div className="text-[9px] font-black text-slate-300 uppercase">Résultat</div>
                          </div>
                          {entry.rank && (
                            <div className="w-10 h-10 rounded-full bg-emerald-50 border border-emerald-100 flex flex-col items-center justify-center">
                              <span className="text-xs font-black text-emerald-600">{entry.rank}e</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="p-8 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button onClick={() => setSelectedSwimmerProfile(null)} className="px-8 py-3 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] shadow-xl hover:scale-105 transition-all">Fermer</button>
            </div>
          </div>
        </div>
      )}

      {/* HIDDEN FILE INPUT (Always in DOM) */}
      <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".xlsx, .xls, .csv" className="hidden" />
    </div>
  );
};
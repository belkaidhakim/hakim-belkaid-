export type Stroke = 'Nage Libre' | 'Dos' | 'Brasse' | 'Papillon' | '4 Nages';
export type PoolSize = 6 | 8;
export type PoolDistance = 25 | 50;

export interface Swimmer {
  id: string;
  firstName: string;
  lastName: string;
  club: string;
  birthYear: number;
  gender: 'M' | 'F';
}

export interface Entry {
  id: string;
  swimmerId: string;
  eventId: string;
  entryTime: string;
  entryTimeMs: number;
  heat?: number | null;
  lane?: number | null;
  // Champs pour les résultats
  resultTime?: string | null;
  resultTimeMs?: number | null;
  rank?: number | null;
  points?: number | null;
  // Pour relais
  isRelay?: boolean;
  relayClub?: string;
}

export interface CompetitionEvent {
  id: string;
  distance: number;
  stroke: Stroke | 'Relais Nage Libre' | 'Relais 4 Nages';
  gender: 'M' | 'F' | 'Mixte';
  ageCategory: string;
  isRelay?: boolean;
}

export interface LaneAssignment {
  lane: number;
  entry: Entry | null;
  swimmer: Swimmer | null; // Peut être null si c'est un relais
}

export interface Heat {
  heatNumber: number;
  assignments: LaneAssignment[];
}

export interface SeededEvent {
  event: CompetitionEvent;
  heats: Heat[];
}

export interface Competition {
  name: string;
  date?: string;
  location?: string;
  poolSize: PoolSize;
  poolDistance: PoolDistance;
  clubs: string[];
  swimmers: Swimmer[];
  events: CompetitionEvent[];
  entries: Entry[];
}
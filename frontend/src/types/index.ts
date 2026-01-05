export interface Question {
  id: string;
  text: string;
}

export interface Session {
  id: string;
  mode: 'single_phone' | 'dual_phone' | null;
  currentQuestionIndex: number;
  isRevealed: boolean;
  questions: Question[];
  createdAt: number;
}

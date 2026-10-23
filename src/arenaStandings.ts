import { TOURNAMENT_ROUNDS, type ArenaPlayer, type ArenaView } from './arenaProtocol';

export type StandingRow = ArenaPlayer & { failedRounds: number; roundScores: (number | null)[] };

// Presentation only: points and ranks are supplied by the server. Null means
// that a round has not finished; a completed loss is always the numeric zero.
export function standingRows(view: ArenaView): StandingRow[] {
  return [...view.players]
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
    .map(player => {
      const results = view.completedRounds.map(round => ({ round: round.round, result: round.players.find(entry => entry.id === player.id) }));
      return {
        ...player,
        failedRounds: results.filter(({ result }) => result && result.status !== 'solved').length
          + (view.status === 'playing' && player.status === 'failed' ? 1 : 0),
        roundScores: Array.from({ length: TOURNAMENT_ROUNDS }, (_, index) => {
          const completed = results.find(entry => entry.round === index + 1);
          return completed?.result?.points ?? null;
        }),
      };
    });
}

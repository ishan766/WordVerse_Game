import { Medal } from 'lucide-react';
import { TOURNAMENT_ROUNDS, type ArenaView } from './arenaProtocol';
import { standingRows } from './arenaStandings';

const medals = ['Gold', 'Silver', 'Bronze'] as const;

export function ArenaLeaderboard({ view, results = false }: { view: ArenaView; results?: boolean }) {
  const rows = standingRows(view);
  const complete = view.status === 'finished';
  return <section className="arena-panel arena-leaderboard" aria-label={results ? 'Tournament standings' : 'Live leaderboard'}>
    <div className="arena-leaderboard-heading">
      <div><span className="eyebrow">SERVER-RANKED</span><h2>{complete ? 'Final standings' : results ? 'Round standings' : 'Live leaderboard'}</h2></div>
      <span className="arena-round-chip">ROUND {view.round} / {TOURNAMENT_ROUNDS}</span>
    </div>
    <p className="arena-leaderboard-context">{complete ? 'Tournament complete · Final totals' : results ? 'Tournament in progress · Latest round included' : 'Scores update when the server accepts a solve'}</p>
    <div className="arena-table-scroll" role="region" aria-label="Leaderboard columns" tabIndex={0}>
      <table className="arena-standings-table">
        <thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col" className="numeric">Total points</th><th scope="col" className="numeric">Rounds won</th><th scope="col" className="numeric">Failed rounds</th></tr></thead>
        <tbody>{rows.map(player => {
          const medal = !player.tie && player.rank <= 3 ? medals[player.rank - 1] : null;
          return <tr key={player.id} className={`${medal ? `arena-rank-${medal.toLowerCase()}` : ''} ${player.tie ? 'arena-rank-tie' : ''} ${player.id === view.selfId ? 'arena-rank-self' : ''}`}>
            <td><span className="arena-rank-place">{medal && <Medal size={17} aria-hidden="true" />}<strong>{player.tie ? `Tied #${player.rank}` : medal ? `${medal} #${player.rank}` : `#${player.rank}`}</strong></span></td>
            <td><div className="arena-table-player"><span className="arena-avatar" aria-hidden="true">{player.name.slice(0, 1).toUpperCase()}</span><span className="arena-table-identity"><strong title={player.name}>{player.name}</strong><small>{player.id === view.selfId && <b>You · </b>}{player.connected ? player.status === 'active' ? 'Solving' : player.status === 'solved' ? 'Solved' : player.status === 'failed' ? 'Failed' : player.status === 'timedout' ? 'Timed out' : player.status : 'Reconnecting'}</small></span></div></td>
            <td className="numeric"><strong className="arena-points" key={`${player.id}-${player.totalPoints}`}>{player.totalPoints}</strong><small className="arena-points-change">+{player.roundPoints} this round</small></td>
            <td className="numeric">{player.wordsSolved}</td>
            <td className="numeric">{player.failedRounds}</td>
          </tr>;
        })}</tbody>
      </table>
      {!rows.length && <p className="arena-table-empty">Players will appear when they join the room.</p>}
    </div>
  </section>;
}

export function ArenaScoreBreakdown({ view }: { view: ArenaView }) {
  const rows = standingRows(view);
  return <section className="arena-panel arena-breakdown" aria-label="Round-by-round scores">
    <div className="arena-leaderboard-heading"><div><span className="eyebrow">SIX-ROUND LEDGER</span><h2>Score breakdown</h2></div><span className="arena-round-chip">{view.completedRounds.length}/{TOURNAMENT_ROUNDS} COMPLETE</span></div>
    <p>Only solved words earn points. A failed or timed-out round earns 0; upcoming rounds are shown as —.</p>
    <div className="arena-table-scroll" role="region" aria-label="Score breakdown columns" tabIndex={0}><table className="arena-score-table">
      <thead><tr><th scope="col">Player</th>{Array.from({ length: TOURNAMENT_ROUNDS }, (_, index) => <th scope="col" key={index}>R{index + 1}</th>)}<th scope="col">Total</th></tr></thead>
      <tbody>{rows.map(player => <tr key={player.id} className={player.id === view.selfId ? 'arena-rank-self' : ''}><th scope="row" title={player.name}>{player.name}</th>{player.roundScores.map((score, index) => <td key={index} aria-label={`Round ${index + 1}: ${score === null ? 'not played' : `${score} points`}`}>{score === null ? '—' : score}</td>)}<td className="arena-breakdown-total">{player.totalPoints}</td></tr>)}</tbody>
    </table></div>
  </section>;
}

interface GoalRingProps {
  achievement: number;
  headline: string;
  caption: string;
  running?: boolean;
}

/** 今日目标环形进度（PRD V-2）。 */
export function GoalRing({ achievement, headline, caption, running = false }: GoalRingProps) {
  const clamped = Math.max(0, Math.min(achievement, 1));
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * clamped;

  return (
    <figure className={`goal-ring${running ? ' goal-ring--running' : ''}`}>
      <svg viewBox="0 0 128 128" role="img" aria-label={`今日目标达成度 ${Math.round(achievement * 100)}%`}>
        <circle cx="64" cy="64" r={radius} className="goal-ring__track" />
        {clamped > 0 && (
          <circle
            cx="64"
            cy="64"
            r={radius}
            className="goal-ring__progress"
            strokeDasharray={`${dash} ${circumference - dash}`}
          />
        )}
      </svg>
      <div className="goal-ring__center">
        <strong>{headline}</strong>
        <span>{caption}</span>
      </div>
      <figcaption className="goal-ring__percent">{Math.round(achievement * 100)}%</figcaption>
    </figure>
  );
}

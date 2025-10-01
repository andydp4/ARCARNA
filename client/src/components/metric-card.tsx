interface MetricCardProps {
  title: string;
  value: string;
  change: string;
  icon: string;
  iconColor: string;
  subtitle: string;
}

export default function MetricCard({
  title,
  value,
  change,
  icon,
  iconColor,
  subtitle,
}: MetricCardProps) {
  return (
    <div className="bg-gradient-to-br from-card to-[hsl(210,40%,98%)] rounded-xl p-6 border border-border shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5">
      <div className="flex items-start justify-between mb-4">
        <div
          className={`w-12 h-12 bg-${iconColor}/10 rounded-lg flex items-center justify-center`}
        >
          <i className={`fas fa-${icon} text-2xl text-${iconColor}`}></i>
        </div>
        <span className="text-xs font-medium text-accent bg-accent/10 px-2 py-1 rounded-full">
          {change}
        </span>
      </div>
      <h3 className="text-muted-foreground text-sm font-medium mb-1">
        {title}
      </h3>
      <p className="text-3xl font-bold text-foreground" data-testid={`metric-${title.toLowerCase().replace(/\s+/g, '-')}`}>
        {value}
      </p>
      <p className="text-xs text-muted-foreground mt-2">{subtitle}</p>
    </div>
  );
}

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RefreshCw, AlertTriangle, CheckCircle, Clock, XCircle, RotateCcw, Eye, Activity } from 'lucide-react';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

type WorkerLog = {
  logId: string;
  eventId: string;
  correlationId: string;
  eventType: string;
  workerName: string;
  status: string;
  attempt: number;
  summary: string | null;
  data: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
};

type DeadLetter = {
  deadLetterId: string;
  jobId: string;
  eventId: string;
  workerName: string;
  failedAt: string;
  error: string | null;
  payloadSnapshot: Record<string, unknown> | null;
};

type WorkerStats = {
  queued: number;
  running: number;
  success: number;
  failed: number;
  deadLetter: number;
};

const statusColors: Record<string, string> = {
  success: 'bg-green-500',
  failed: 'bg-red-500',
  retrying: 'bg-yellow-500',
  dead_letter: 'bg-red-700',
  already_processed: 'bg-blue-500',
  queued: 'bg-gray-500',
  running: 'bg-blue-400',
};

const statusIcons: Record<string, JSX.Element> = {
  success: <CheckCircle className="h-4 w-4" />,
  failed: <XCircle className="h-4 w-4" />,
  retrying: <Clock className="h-4 w-4" />,
  dead_letter: <AlertTriangle className="h-4 w-4" />,
  already_processed: <CheckCircle className="h-4 w-4" />,
  queued: <Clock className="h-4 w-4" />,
  running: <Activity className="h-4 w-4" />,
};

export default function WorkerLogsPage() {
  const { toast } = useToast();
  const [filters, setFilters] = useState({
    eventId: '',
    correlationId: '',
    workerName: '',
    status: '',
  });
  const [selectedLog, setSelectedLog] = useState<WorkerLog | null>(null);

  const { data: stats, refetch: refetchStats } = useQuery<WorkerStats>({
    queryKey: ['/api/admin/worker-stats'],
  });

  const { data: logs = [], isLoading: logsLoading, refetch: refetchLogs } = useQuery<WorkerLog[]>({
    queryKey: ['/api/admin/worker-logs', filters],
  });

  const { data: deadLetters = [], isLoading: deadLettersLoading, refetch: refetchDeadLetters } = useQuery<DeadLetter[]>({
    queryKey: ['/api/admin/dead-letters'],
  });

  const retryMutation = useMutation({
    mutationFn: async (deadLetterId: string) => {
      return apiRequest('POST', `/api/admin/dead-letters/${deadLetterId}/retry`);
    },
    onSuccess: () => {
      toast({ title: 'Success', description: 'Dead letter requeued for retry' });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/dead-letters'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/worker-stats'] });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const handleRefresh = () => {
    refetchStats();
    refetchLogs();
    refetchDeadLetters();
  };

  const workerNames = [
    'InventoryWorker',
    'CustomerWorker',
    'InvoiceWorker',
    'LoyaltyWorker',
    'BusinessInsightsWorker',
    'FinanceWorker',
    'ExpensesWorker',
  ];

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="page-title">Worker Run Logs</h1>
          <p className="text-muted-foreground">Monitor event processing and worker status</p>
        </div>
        <Button onClick={handleRefresh} variant="outline" data-testid="btn-refresh">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Queued</p>
                <p className="text-2xl font-bold" data-testid="stat-queued">{stats?.queued || 0}</p>
              </div>
              <Clock className="h-8 w-8 text-gray-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Running</p>
                <p className="text-2xl font-bold" data-testid="stat-running">{stats?.running || 0}</p>
              </div>
              <Activity className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Success</p>
                <p className="text-2xl font-bold text-green-600" data-testid="stat-success">{stats?.success || 0}</p>
              </div>
              <CheckCircle className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Failed</p>
                <p className="text-2xl font-bold text-red-600" data-testid="stat-failed">{stats?.failed || 0}</p>
              </div>
              <XCircle className="h-8 w-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Dead Letters</p>
                <p className="text-2xl font-bold text-red-800" data-testid="stat-dead-letters">{stats?.deadLetter || 0}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-red-700" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="logs" className="space-y-4">
        <TabsList>
          <TabsTrigger value="logs" data-testid="tab-logs">Worker Logs</TabsTrigger>
          <TabsTrigger value="dead-letters" data-testid="tab-dead-letters">
            Dead Letters
            {(stats?.deadLetter || 0) > 0 && (
              <Badge variant="destructive" className="ml-2">{stats?.deadLetter}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="logs" className="space-y-4">
          {/* Filters */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Filters</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Event ID</label>
                  <Input
                    placeholder="Filter by event ID..."
                    value={filters.eventId}
                    onChange={(e) => setFilters({ ...filters, eventId: e.target.value })}
                    data-testid="input-event-id"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Order ID</label>
                  <Input
                    placeholder="Filter by order ID..."
                    value={filters.correlationId}
                    onChange={(e) => setFilters({ ...filters, correlationId: e.target.value })}
                    data-testid="input-correlation-id"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Worker</label>
                  <Select
                    value={filters.workerName || "all"}
                    onValueChange={(value) => setFilters({ ...filters, workerName: value === "all" ? "" : value })}
                  >
                    <SelectTrigger data-testid="select-worker">
                      <SelectValue placeholder="All workers" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All workers</SelectItem>
                      {workerNames.map((name) => (
                        <SelectItem key={name} value={name}>{name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Status</label>
                  <Select
                    value={filters.status || "all"}
                    onValueChange={(value) => setFilters({ ...filters, status: value === "all" ? "" : value })}
                  >
                    <SelectTrigger data-testid="select-status">
                      <SelectValue placeholder="All statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="success">Success</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                      <SelectItem value="retrying">Retrying</SelectItem>
                      <SelectItem value="dead_letter">Dead Letter</SelectItem>
                      <SelectItem value="already_processed">Already Processed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Logs Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Logs</CardTitle>
              <CardDescription>Last 100 worker execution logs</CardDescription>
            </CardHeader>
            <CardContent>
              {logsLoading ? (
                <div className="flex justify-center py-8">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : logs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No logs found. Events will appear here when orders are processed.
                </div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Event Type</TableHead>
                        <TableHead>Worker</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Summary</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map((log) => (
                        <TableRow key={log.logId} data-testid={`row-log-${log.logId}`}>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {log.createdAt ? format(new Date(log.createdAt), 'HH:mm:ss') : '-'}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{log.eventType}</Badge>
                          </TableCell>
                          <TableCell className="font-mono text-sm">{log.workerName}</TableCell>
                          <TableCell>
                            <Badge className={`${statusColors[log.status]} text-white`}>
                              <span className="flex items-center gap-1">
                                {statusIcons[log.status]}
                                {log.status}
                              </span>
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate" title={log.summary || ''}>
                            {log.summary || '-'}
                          </TableCell>
                          <TableCell>
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setSelectedLog(log)}
                                  data-testid={`btn-view-${log.logId}`}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-2xl">
                                <DialogHeader>
                                  <DialogTitle>Log Details</DialogTitle>
                                  <DialogDescription>
                                    {log.workerName} - {log.eventType}
                                  </DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4">
                                  <div className="grid grid-cols-2 gap-4">
                                    <div>
                                      <label className="text-sm font-medium">Event ID</label>
                                      <p className="text-sm font-mono">{log.eventId}</p>
                                    </div>
                                    <div>
                                      <label className="text-sm font-medium">Correlation ID</label>
                                      <p className="text-sm font-mono">{log.correlationId}</p>
                                    </div>
                                    <div>
                                      <label className="text-sm font-medium">Attempt</label>
                                      <p className="text-sm">{log.attempt}</p>
                                    </div>
                                    <div>
                                      <label className="text-sm font-medium">Status</label>
                                      <Badge className={`${statusColors[log.status]} text-white`}>
                                        {log.status}
                                      </Badge>
                                    </div>
                                  </div>
                                  {log.summary && (
                                    <div>
                                      <label className="text-sm font-medium">Summary</label>
                                      <p className="text-sm">{log.summary}</p>
                                    </div>
                                  )}
                                  {log.error && (
                                    <div>
                                      <label className="text-sm font-medium text-red-600">Error</label>
                                      <pre className="text-sm bg-red-50 dark:bg-red-900/20 p-2 rounded overflow-auto">
                                        {log.error}
                                      </pre>
                                    </div>
                                  )}
                                  {log.data && (
                                    <div>
                                      <label className="text-sm font-medium">Data</label>
                                      <pre className="text-sm bg-muted p-2 rounded overflow-auto max-h-[200px]">
                                        {JSON.stringify(log.data, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              </DialogContent>
                            </Dialog>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="dead-letters" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Dead Letters</CardTitle>
              <CardDescription>
                Failed jobs that have exceeded maximum retry attempts
              </CardDescription>
            </CardHeader>
            <CardContent>
              {deadLettersLoading ? (
                <div className="flex justify-center py-8">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : deadLetters.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle className="h-12 w-12 mx-auto mb-2 text-green-500" />
                  <p>No dead letters. All jobs are processing successfully!</p>
                </div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Failed At</TableHead>
                        <TableHead>Event ID</TableHead>
                        <TableHead>Worker</TableHead>
                        <TableHead>Error</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deadLetters.map((dl) => (
                        <TableRow key={dl.deadLetterId} data-testid={`row-dead-letter-${dl.deadLetterId}`}>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {dl.failedAt ? format(new Date(dl.failedAt), 'MMM d, HH:mm:ss') : '-'}
                          </TableCell>
                          <TableCell className="font-mono text-sm max-w-[150px] truncate">
                            {dl.eventId}
                          </TableCell>
                          <TableCell className="font-mono text-sm">{dl.workerName}</TableCell>
                          <TableCell className="max-w-[300px] truncate text-red-600" title={dl.error || ''}>
                            {dl.error || '-'}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => retryMutation.mutate(dl.deadLetterId)}
                              disabled={retryMutation.isPending}
                              data-testid={`btn-retry-${dl.deadLetterId}`}
                            >
                              <RotateCcw className="h-4 w-4 mr-1" />
                              Retry
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

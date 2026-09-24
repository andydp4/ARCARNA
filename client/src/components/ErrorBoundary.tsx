
import { Component, ReactNode } from 'react';
import * as Sentry from '@sentry/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';
import { isChunkLoadError, makeReferenceCode, reloadOnceInBrowser } from '@/lib/crashReporting';
import { recordCrash } from '@/lib/usage';

interface Props {
  children: ReactNode;
  /**
   * "app" wraps everything (full-screen card); "page" wraps one routed page
   * inside Layout, so a crash on one page leaves the sidebar and the till
   * usable. Changing `resetKey` (the location) clears a page crash.
   */
  scope?: 'app' | 'page';
  resetKey?: string;
}

interface State {
  hasError: boolean;
  reference?: string;
  reloading?: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, reference: undefined, reloading: false });
    }
  }

  componentDidCatch(error: Error, errorInfo: { componentStack?: string | null }) {
    // Our own usage record (v1.2 Phase 8B): the kind of crash and the screen, nothing from the error.
    recordCrash(isChunkLoadError(error) ? 'chunk' : 'boundary');
    // A stale chunk after a deploy is not a bug: fetch the new build once.
    if (isChunkLoadError(error) && reloadOnceInBrowser()) {
      this.setState({ reloading: true });
      return;
    }
    const reference = makeReferenceCode();
    this.setState({ reference });
    console.error('Error caught by boundary:', error);
    // Before this, boundary-caught crashes never reached Sentry: React does
    // not rethrow them to window.onerror in production builds.
    Sentry.captureException(error, {
      tags: { ref: reference, boundary: this.props.scope ?? 'app' },
      contexts: { react: { componentStack: errorInfo?.componentStack ?? '' } },
    });
  }

  private reset = () => this.setState({ hasError: false, reference: undefined, reloading: false });

  render() {
    if (!this.state.hasError) return this.props.children;

    const isPage = this.props.scope === 'page';
    if (this.state.reloading) {
      return (
        <div className="p-6 text-center text-sm text-muted-foreground" data-testid="error-boundary-reloading">
          Loading the latest version…
        </div>
      );
    }

    return (
      <div
        className={isPage ? 'flex justify-center p-4 sm:p-8' : 'min-h-screen flex items-center justify-center bg-background p-4'}
        data-testid={isPage ? 'error-boundary-page' : 'error-boundary-app'}
      >
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Something went wrong
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {isPage
                ? 'This page hit a problem. The rest of arcarna is still working.'
                : 'arcarna hit a problem and could not continue.'}{' '}
              It has been reported automatically.
            </p>
            {this.state.reference && (
              <p className="text-sm">
                Reference code:{' '}
                <span className="font-mono font-semibold" data-testid="text-error-reference">
                  {this.state.reference}
                </span>
              </p>
            )}
            <div className="flex gap-2">
              {isPage && (
                <Button variant="outline" onClick={this.reset} className="flex-1" data-testid="button-error-retry">
                  Try again
                </Button>
              )}
              <Button onClick={() => window.location.reload()} className="flex-1" data-testid="button-error-reload">
                Reload page
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
}

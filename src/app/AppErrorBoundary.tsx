import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorScreen } from './ErrorScreen';

interface State {
  hasError: boolean;
}

/** Last-resort boundary for crashes outside the router. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[app] unhandled error', error, info.componentStack);
  }

  render() {
    return this.state.hasError ? <ErrorScreen /> : this.props.children;
  }
}

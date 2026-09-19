import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, EmptyState } from '../ui';
import { Icon } from '../ui/icons';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Bir ekranın çökmesi tüm uygulamayı götürmesin; hata durumu da tasarlanmıştır. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Ekran hatası:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <EmptyState
          tone="error"
          icon={<Icon name="alert" size={28} />}
          title="Bu ekran açılamadı"
          description={this.state.error.message}
          action={<Button onClick={() => this.setState({ error: null })}>Yeniden dene</Button>}
        />
      );
    }
    return this.props.children;
  }
}

export interface ServiceDescriptor<T> {
  token: symbol | string;
  factory: (container: Container) => T;
  singleton: boolean;
}

export class Container {
  private services = new Map<symbol | string, ServiceDescriptor<any>>();
  private instances = new Map<symbol | string, any>();
  private resolving = new Set<symbol | string>();

  register<T>(token: symbol | string, factory: (container: Container) => T, singleton = true): this {
    if (this.services.has(token)) {
      throw new Error(`Service ${String(token)} already registered`);
    }
    this.services.set(token, { token, factory, singleton });
    return this;
  }

  registerSingleton<T>(token: symbol | string, instance: T): this {
    this.instances.set(token, instance);
    return this;
  }

  registerFactory<T>(token: symbol | string, factory: (container: Container) => T): this {
    return this.register(token, factory, false);
  }

  registerSingletonFactory<T>(token: symbol | string, factory: (container: Container) => T): this {
    return this.register(token, factory, true);
  }

  resolve<T>(token: symbol | string): T {
    if (this.instances.has(token)) {
      return this.instances.get(token) as T;
    }

    const descriptor = this.services.get(token);
    if (!descriptor) {
      throw new Error(`Service ${String(token)} not registered`);
    }

    if (this.resolving.has(token)) {
      throw new Error(`Circular dependency detected for ${String(token)}`);
    }

    this.resolving.add(token);
    try {
      const instance = descriptor.factory(this);
      if (descriptor.singleton) {
        this.instances.set(token, instance);
      }
      return instance as T;
    } finally {
      this.resolving.delete(token);
    }
  }

  async resolveAsync<T>(token: symbol | string): Promise<T> {
    return this.resolve(token);
  }

  has(token: symbol | string): boolean {
    return this.services.has(token) || this.instances.has(token);
  }

  unregister(token: symbol | string): boolean {
    this.services.delete(token);
    return this.instances.delete(token);
  }

  clear(): void {
    this.services.clear();
    this.instances.clear();
  }

  createScope(): Container {
    const scope = new Container();
    scope.services = new Map(this.services);
    scope.instances = new Map(this.instances);
    return scope;
  }
}

export const container = new Container();

export function createContainer(): Container {
  return new Container();
}

export const TOKENS = {
  Config: Symbol('Config'),
  Logger: Symbol('Logger'),
  Database: Symbol('Database'),
  DiscordClient: Symbol('DiscordClient'),
  GmailClient: Symbol('GmailClient'),
  OpenAIClient: Symbol('OpenAIClient'),
  HttpClient: Symbol('HttpClient'),
  Metrics: Symbol('Metrics'),
  HealthCheck: Symbol('HealthCheck'),
  Cache: Symbol('Cache'),
  Queue: Symbol('Queue'),
  Scheduler: Symbol('Scheduler'),
  EventBus: Symbol('EventBus'),
  CommandRegistry: Symbol('CommandRegistry'),
  EventRegistry: Symbol('EventRegistry'),
  ApprovalService: Symbol('ApprovalService'),
  AuditService: Symbol('AuditService'),
  PermissionService: Symbol('PermissionService'),
  RateLimiter: Symbol('RateLimiter'),
} as const;
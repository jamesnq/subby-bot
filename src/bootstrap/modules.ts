import { Container } from './container';
import { TOKENS } from './container';

export interface Module {
  name: string;
  dependencies?: string[];
  register: (container: Container) => void | Promise<void>;
  bootstrap?: (container: Container) => void | Promise<void>;
  shutdown?: (container: Container) => void | Promise<void>;
}

export class ModuleRegistry {
  private modules = new Map<string, Module>();
  private loadOrder: string[] = [];

  register(module: Module): this {
    if (this.modules.has(module.name)) {
      throw new Error(`Module ${module.name} already registered`);
    }
    this.modules.set(module.name, module);
    return this;
  }

  get(name: string): Module | undefined {
    return this.modules.get(name);
  }

  has(name: string): boolean {
    return this.modules.has(name);
  }

  getAll(): Module[] {
    return Array.from(this.modules.values());
  }

  private topologicalSort(): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const result: string[] = [];

    const visit = (name: string) => {
      if (visiting.has(name)) {
        throw new Error(`Circular dependency detected involving ${name}`);
      }
      if (visited.has(name)) return;

      visiting.add(name);
      const module = this.modules.get(name);
      if (module?.dependencies) {
        for (const dep of module.dependencies) {
          if (!this.modules.has(dep)) {
            throw new Error(`Module ${name} depends on missing module ${dep}`);
          }
          visit(dep);
        }
      }
      visiting.delete(name);
      visited.add(name);
      result.push(name);
    };

    for (const name of this.modules.keys()) {
      visit(name);
    }

    return result;
  }

  async bootstrapAll(container: Container): Promise<void> {
    const order = this.topologicalSort();
    this.loadOrder = order;

    for (const name of order) {
      const module = this.modules.get(name)!;
      if (module.bootstrap) {
        await module.bootstrap(container);
      }
    }
  }

  async registerAll(container: Container): Promise<void> {
    const order = this.topologicalSort();
    
    for (const name of order) {
      const module = this.modules.get(name)!;
      await module.register(container);
    }
  }

  async shutdownAll(container: Container): Promise<void> {
    const order = [...this.loadOrder].reverse();
    
    for (const name of order) {
      const module = this.modules.get(name)!;
      if (module.shutdown) {
        await module.shutdown(container);
      }
    }
  }
}

export const moduleRegistry = new ModuleRegistry();

export function createModule(name: string, config: Omit<Module, 'name'>): Module {
  return { name, ...config };
}

export function defineModule(module: Module): Module {
  moduleRegistry.register(module);
  return module;
}
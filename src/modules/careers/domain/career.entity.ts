export class Career {
  id: string;
  code: string;
  name: string;

  constructor({
    id,
    code,
    name,
  }: {
    id: string;
    code: string;
    name: string;
  }) {
    this.id = id;
    this.code = code;
    this.name = name;
  }

  toJSON(): {
    id: string;
    code: string;
    name: string;
  } {
    return {
      id: this.id,
      code: this.code,
      name: this.name,
    };
  }
}

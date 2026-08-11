CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  documento TEXT NOT NULL UNIQUE,
  nombres TEXT NOT NULL,
  apellidos TEXT NOT NULL,
  fecha_nacimiento DATE NOT NULL,
  email TEXT NOT NULL,
  celular TEXT NOT NULL,
  sexo TEXT NOT NULL,
  direccion TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

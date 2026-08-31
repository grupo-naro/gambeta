/**
 * Firma del estudio, al pie de todas las pantallas del sitio.
 *
 * Discreta a propósito: en reposo el "Desarrollado por" casi se funde con el fondo y solo
 * el nombre levanta un tono. El lima del hover es el mismo que el resto de la pantalla usa
 * para todo lo clickeable, así que se lee como un link sin tener que parecerlo en reposo.
 */
export function FirmaNaro() {
  return (
    <footer className="border-t border-neutral-900 px-4 py-5 text-center text-xs text-neutral-600">
      Desarrollado por{' '}
      <a
        href="https://www.gruponaro.com.ar/"
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-neutral-400 underline-offset-4 transition-colors hover:text-lime-400 hover:underline"
      >
        Grupo Naro
      </a>
    </footer>
  );
}

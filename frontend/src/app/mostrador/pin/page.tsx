import { redirect } from 'next/navigation';
import { sesionBuffetValida } from '@/lib/buffet-session';
import { PinForm } from '@/components/mostrador/pin-form';

export default async function MostradorPinPage() {
  if (await sesionBuffetValida()) redirect('/mostrador');
  return <PinForm />;
}

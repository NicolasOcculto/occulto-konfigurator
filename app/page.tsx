import Configurator from '@/components/Configurator';
import { PRODUCT_CARDS } from '@/lib/products';

export default function Page() {
  return <Configurator products={PRODUCT_CARDS} />;
}

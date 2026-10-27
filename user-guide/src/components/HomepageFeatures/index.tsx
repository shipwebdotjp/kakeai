import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Heading from '@theme/Heading';
import {docRoutes} from '@site/src/routes';
import styles from './styles.module.css';

type GuidePath = {
  id: string;
  title: string;
  description: string;
  href: string;
  action: string;
};

const guidePaths: GuidePath[] = [
  {
    id: 'start',
    title: 'まずは動画を作る',
    description: 'インストールから作品の作成、プレビュー、MP4出力までを順番に確認できます。',
    href: docRoutes.installation,
    action: 'インストールから始める',
  },
  {
    id: 'feature-lookup',
    title: '機能から探す',
    description: '作品管理、素材ライブラリ、音声プロファイルなど、使いたい機能の説明を探せます。',
    href: docRoutes.docsHome,
    action: 'ガイドの目次を見る',
  },
  {
    id: 'advanced',
    title: '応用・自動化',
    description: '映像のカスタマイズやエージェント連携など、制作を広げる機能を案内します。',
    href: docRoutes.agentAccess,
    action: 'エージェント連携を見る',
  },
];

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {guidePaths.map((path) => (
            <div className="col col--4 margin-bottom--md" key={path.id}>
              <article className={styles.card}>
                <Heading as="h2">{path.title}</Heading>
                <p>{path.description}</p>
                <Link className="button button--primary" to={path.href}>
                  {path.action}
                </Link>
              </article>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

<?php
/**
 * Dashboard side of the live chat module:
 *   - the "چت آنلاین" tab inside the Tamas Box settings screen
 *   - the "گفتگوها" inbox page
 *   - AJAX helpers (test the bot token, register the webhook, ...)
 *
 * @package Tamas_Box
 * @since   3.2.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class TMB_Chat_Admin {

	const INBOX_SLUG = 'tamas-box-chats';

	/**
	 * Shared instance (used by the settings screen too).
	 *
	 * @var TMB_Chat_Admin|null
	 */
	private static $instance = null;

	/**
	 * Get the single instance.
	 *
	 * @return TMB_Chat_Admin
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	public function __construct() {
		add_action( 'admin_menu', array( $this, 'menu' ), 20 );
		add_action( 'admin_enqueue_scripts', array( $this, 'assets' ) );

		add_action( 'wp_ajax_tmb_chat_test', array( $this, 'ajax_test' ) );
		add_action( 'wp_ajax_tmb_chat_set_webhook', array( $this, 'ajax_set_webhook' ) );
		add_action( 'wp_ajax_tmb_chat_delete_webhook', array( $this, 'ajax_delete_webhook' ) );
		add_action( 'wp_ajax_tmb_chat_webhook_info', array( $this, 'ajax_webhook_info' ) );
		add_action( 'wp_ajax_tmb_chat_poll_now', array( $this, 'ajax_poll_now' ) );
		add_action( 'wp_ajax_tmb_chat_admin_link', array( $this, 'ajax_admin_link' ) );
		add_action( 'wp_ajax_tmb_chat_item_first', array( $this, 'ajax_item_first' ) );
		add_action( 'wp_ajax_tmb_chat_diag', array( $this, 'ajax_diag' ) );
		add_action( 'wp_ajax_tmb_chat_purge_cache', array( $this, 'ajax_purge_cache' ) );

		add_action( 'admin_init', array( $this, 'maybe_clear_notice' ) );
		add_action( 'admin_notices', array( $this, 'upgrade_notice' ) );
	}

	/**
	 * Drop the "chat was turned on for you" notice once it is not needed.
	 *
	 * @return void
	 */
	public function maybe_clear_notice() {
		if ( ! get_option( 'tmb_chat_upgrade_notice' ) ) {
			return;
		}

		$dismissed = isset( $_GET['tmb_chat_notice'] ); // phpcs:ignore WordPress.Security.NonceVerification

		if ( $dismissed && current_user_can( 'manage_options' ) ) {
			delete_option( 'tmb_chat_upgrade_notice' );
			return;
		}

		// Bale is connected - nothing left to remind the admin about.
		if ( TMB_Chat_Bale::is_ready() ) {
			delete_option( 'tmb_chat_upgrade_notice' );
		}
	}

	/**
	 * One time notice after the 3.2.0 update.
	 *
	 * @return void
	 */
	public function upgrade_notice() {
		if ( ! get_option( 'tmb_chat_upgrade_notice' ) || ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$settings_url = admin_url( 'admin.php?page=tamas-box#tab-chat' );
		$hide_url     = add_query_arg( 'tmb_chat_notice', '0' );
		?>
		<div class="notice notice-info is-dismissible">
			<p>
				<strong><?php esc_html_e( 'تماس باکس ۳.۲ — چت آنلاین فعال شد.', 'tamas-box' ); ?></strong>
				<?php esc_html_e( 'یک آیتم «چت آنلاین» به باکس‌های تماس شما اضافه شد.', 'tamas-box' ); ?>
			</p>
			<p>
				<?php esc_html_e( 'برای اینکه پیام‌های مشتری در بله به دست شما برسد، توکن بازو و شناسه چت خود را وارد کنید:', 'tamas-box' ); ?>
				<a class="button button-primary" href="<?php echo esc_url( $settings_url ); ?>"><?php esc_html_e( 'اتصال به بله', 'tamas-box' ); ?></a>
				<a class="button" href="<?php echo esc_url( admin_url( 'admin.php?page=' . self::INBOX_SLUG ) ); ?>"><?php esc_html_e( 'صندوق گفتگوها', 'tamas-box' ); ?></a>
				<a href="<?php echo esc_url( $hide_url ); ?>"><?php esc_html_e( 'بعداً', 'tamas-box' ); ?></a>
			</p>
		</div>
		<?php
	}

	/**
	 * Submenu entry + unread badge.
	 *
	 * @return void
	 */
	public function menu() {
		$label = __( 'گفتگوها', 'tamas-box' );

		if ( TMB_Chat::enabled() ) {
			$counters = TMB_Chat_DB::counters();

			if ( ! empty( $counters['unread'] ) ) {
				$label .= sprintf(
					' <span class="awaiting-mod count-%1$d"><span class="pending-count">%1$d</span></span>',
					(int) $counters['unread']
				);
			}
		}

		add_submenu_page(
			'tamas-box',
			__( 'گفتگوهای آنلاین', 'tamas-box' ),
			$label,
			'manage_options',
			self::INBOX_SLUG,
			array( $this, 'render_inbox' )
		);
	}

	/**
	 * Enqueue inbox / settings assets.
	 *
	 * @param string $hook Current screen.
	 * @return void
	 */
	public function assets( $hook ) {
		$is_chat_page = ( false !== strpos( $hook, self::INBOX_SLUG ) );
		$is_settings  = ( false !== strpos( $hook, 'tamas-box' ) && ! $is_chat_page );

		if ( ! $is_chat_page && ! $is_settings ) {
			return;
		}

		wp_enqueue_style( 'tmb-admin', TMB_URL . 'assets/css/admin.css', array(), TMB_VERSION );
		wp_enqueue_style( 'tmb-chat-admin', TMB_URL . 'assets/css/chat-admin.css', array( 'tmb-admin' ), TMB_VERSION );
		wp_enqueue_script( 'tmb-chat-admin', TMB_URL . 'assets/js/admin-chat.js', array( 'jquery' ), TMB_VERSION, true );

		wp_localize_script(
			'tmb-chat-admin',
			'TMB_CHAT_ADMIN',
			array(
				'rest'      => esc_url_raw( rest_url( TMB_Chat::REST_NAMESPACE . '/chat' ) ),
				'nonce'     => wp_create_nonce( 'wp_rest' ),
				'ajaxUrl'   => admin_url( 'admin-ajax.php' ),
				'ajaxNonce' => wp_create_nonce( 'tmb_chat_admin' ),
				'inbox'     => $is_chat_page ? 1 : 0,
				'i18n'      => array(
					'loading'      => __( 'در حال بارگذاری…', 'tamas-box' ),
					'empty'        => __( 'گفتگویی وجود ندارد.', 'tamas-box' ),
					'noSelection'  => __( 'یک گفتگو را از فهرست انتخاب کنید.', 'tamas-box' ),
					'send'         => __( 'ارسال', 'tamas-box' ),
					'sending'      => __( 'در حال ارسال…', 'tamas-box' ),
					'open'         => __( 'باز', 'tamas-box' ),
					'closed'       => __( 'بسته', 'tamas-box' ),
					'closeChat'    => __( 'بستن گفتگو', 'tamas-box' ),
					'reopenChat'   => __( 'باز کردن گفتگو', 'tamas-box' ),
					'deleteChat'   => __( 'حذف گفتگو', 'tamas-box' ),
					'confirmDelete'=> __( 'این گفتگو و همه پیام‌هایش برای همیشه حذف شود؟', 'tamas-box' ),
					'guest'        => __( 'مهمان', 'tamas-box' ),
					'visitor'      => __( 'بازدیدکننده', 'tamas-box' ),
					'agent'        => __( 'پشتیبانی', 'tamas-box' ),
					'system'       => __( 'سیستم', 'tamas-box' ),
					'error'        => __( 'خطا در ارتباط با سرور.', 'tamas-box' ),
					'all'          => __( 'همه', 'tamas-box' ),
					'newMessages'  => __( 'پیام جدید', 'tamas-box' ),
					'working'      => __( 'در حال انجام…', 'tamas-box' ),
				),
			)
		);
	}

	/* ---------------------------------------------------------------------
	 * Settings tab
	 * ------------------------------------------------------------------ */

	/**
	 * The "چت آنلاین" tab, rendered inside the main settings form.
	 *
	 * @param string $o Option name.
	 * @return void
	 */
	public function settings_tab( $o ) {
		$c       = TMB_Settings::chat();
		$n       = $o . '[chat]';
		$icons   = TMB_Icons::all();
		$days    = TMB_Visibility::days();
		$ready   = TMB_Chat_Bale::is_ready();
		$error   = TMB_Chat_Bale::last_error();
		$state   = TMB_Chat_DB::state();
		$webhook = TMB_Chat_Bale::webhook_url();
		$https   = ( 0 === strpos( home_url(), 'https://' ) );
		?>
		<section id="tab-chat" class="tmb-panel">
			<div class="tmb-section-head">
				<div>
					<h2><?php esc_html_e( 'چت آنلاین', 'tamas-box' ); ?></h2>
					<p class="tmb-desc">
						<?php esc_html_e( 'بازدیدکننده داخل سایت پیام می‌دهد، پیام در بله به دست شما می‌رسد و پاسخ شما دوباره در همان چت‌باکس سایت نمایش داده می‌شود.', 'tamas-box' ); ?>
					</p>
				</div>
			</div>

			<div class="tmb-field tmb-switch-row tmb-chat-master">
				<label class="tmb-switch">
					<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[enabled]" value="1" <?php checked( $c['enabled'], 1 ); ?>>
					<span class="tmb-slider"></span>
				</label>
				<div>
					<strong><?php esc_html_e( 'فعال کردن چت آنلاین', 'tamas-box' ); ?></strong>
					<p class="tmb-desc"><?php esc_html_e( 'با خاموش بودن این گزینه، هیچ ویجت چتی در سایت نمایش داده نمی‌شود.', 'tamas-box' ); ?></p>
				</div>
			</div>

			<?php if ( empty( $c['enabled'] ) ) : ?>
				<p class="tmb-note tmb-note-warn">
					<strong><?php esc_html_e( 'ماژول چت خاموش است.', 'tamas-box' ); ?></strong>
					<?php esc_html_e( 'تا وقتی کلید بالا روشن نشود، دکمه «چت آنلاین» در سایت هیچ کاری نمی‌کند و پنجره چت ساخته نمی‌شود.', 'tamas-box' ); ?>
				</p>
			<?php endif; ?>

			<?php if ( empty( $c['bale_chat_ids'] ) ) : ?>
				<p class="tmb-note tmb-note-warn">
					<strong><?php esc_html_e( 'شناسه چت مدیران خالی است.', 'tamas-box' ); ?></strong>
					<?php esc_html_e( 'پیام مشتریان ذخیره می‌شود ولی به هیچ‌کس در بله نمی‌رسد. از دکمه «لینک ثبت مدیر» استفاده کنید یا در بله به بازو /id بفرستید.', 'tamas-box' ); ?>
				</p>
			<?php endif; ?>

			<!-- ============ اتصال به بله ============ -->
			<div class="tmb-card tmb-bale-card">
				<h3>🔗 <?php esc_html_e( 'اتصال به بله', 'tamas-box' ); ?></h3>
				<p class="tmb-desc">
					<?php esc_html_e( 'توکن بازوی بله را از «بات‌فادر بله» (@botfather در ble.ir) بگیرید و اینجا وارد کنید.', 'tamas-box' ); ?>
				</p>

				<div class="tmb-grid-2">
					<div class="tmb-field">
						<label><?php esc_html_e( 'توکن بازو (Bot Token)', 'tamas-box' ); ?></label>
						<input type="text" class="ltr tmb-chat-token" name="<?php echo esc_attr( $n ); ?>[bale_token]" value="<?php echo esc_attr( $c['bale_token'] ); ?>" placeholder="123456789:abcdIuZmK5qNEm2A1BhUaAg7MPJv1O9KCcBQB2ro" autocomplete="off" spellcheck="false" dir="ltr">
						<p class="tmb-desc"><?php esc_html_e( 'قالب: عدد دونقطه رشته. این مقدار فقط در دیتابیس سایت شما ذخیره می‌شود.', 'tamas-box' ); ?></p>
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'آدرس API', 'tamas-box' ); ?></label>
						<input type="text" class="ltr tmb-chat-base" name="<?php echo esc_attr( $n ); ?>[bale_api_base]" value="<?php echo esc_attr( $c['bale_api_base'] ); ?>" dir="ltr">
						<p class="tmb-desc">
							<?php esc_html_e( 'عادی:', 'tamas-box' ); ?> <code>https://tapi.bale.ai/bot</code><br>
							<?php esc_html_e( 'کسب‌وکاری:', 'tamas-box' ); ?> <code>https://tapi.bale.ai/business/bot</code>
						</p>
					</div>
				</div>

				<div class="tmb-field">
					<label><?php esc_html_e( 'شناسه چت مدیران (هر خط یک مورد)', 'tamas-box' ); ?></label>
					<textarea class="ltr tmb-chat-ids" rows="3" name="<?php echo esc_attr( $n ); ?>[bale_chat_ids]" placeholder="-1001234567890&#10;987654321&#10;@mychannel" dir="ltr"><?php echo esc_textarea( $c['bale_chat_ids'] ); ?></textarea>
					<p class="tmb-note tmb-note-warn tmb-phone-note">
						<strong><?php esc_html_e( 'شماره موبایل اینجا کار نمی‌کند!', 'tamas-box' ); ?></strong>
						<?php esc_html_e( 'بازوی بله فقط با «شناسه چت» (یک عدد مثل 987654321 یا عدد منفی برای گروه/کانال) یا «@نام‌کاربری کانال» می‌تواند پیام بفرستد. با شماره تلفن یا آیدی شخصی امکان‌پذیر نیست — این محدودیت خودِ بله است، نه افزونه.', 'tamas-box' ); ?>
					</p>
					<p class="tmb-desc">
						<strong><?php esc_html_e( 'ساده‌ترین راه:', 'tamas-box' ); ?></strong>
						<?php esc_html_e( 'دکمه «لینک ثبت مدیر» را بزنید و لینکی که می‌سازد را در بله باز کنید؛ شناسه چت شما خودکار همین‌جا ثبت می‌شود. راه دیگر: در بله به بازوی خود پیام /id بدهید (حتی قبل از ثبت شدن به‌عنوان مدیر هم جواب می‌دهد). برای گروه: بازو را عضو گروه کنید و داخل گروه /id بفرستید.', 'tamas-box' ); ?>
					</p>
				</div>

				<div class="tmb-grid-2">
					<div class="tmb-field">
						<label><?php esc_html_e( 'نام کاربری بازو (بدون @)', 'tamas-box' ); ?></label>
						<input type="text" class="ltr" name="<?php echo esc_attr( $n ); ?>[bale_bot_username]" value="<?php echo esc_attr( $c['bale_bot_username'] ); ?>" placeholder="mybot" dir="ltr">
						<p class="tmb-desc"><?php esc_html_e( 'با «تست اتصال» خودکار پر می‌شود. برای ساخت لینک ثبت مدیر لازم است.', 'tamas-box' ); ?></p>
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'نام نمایشی بازو', 'tamas-box' ); ?></label>
						<input type="text" name="<?php echo esc_attr( $n ); ?>[bale_bot_name]" value="<?php echo esc_attr( $c['bale_bot_name'] ); ?>" placeholder="<?php esc_attr_e( 'پشتیبانی سایت', 'tamas-box' ); ?>">
					</div>
				</div>

				<div class="tmb-chat-actions">
					<button type="button" class="button" data-tmb-chat="test">🔌 <?php esc_html_e( 'تست اتصال', 'tamas-box' ); ?></button>
					<button type="button" class="button button-primary" data-tmb-chat="set-webhook">📡 <?php esc_html_e( 'ثبت وب‌هوک', 'tamas-box' ); ?></button>
					<button type="button" class="button" data-tmb-chat="webhook-info">ℹ️ <?php esc_html_e( 'وضعیت وب‌هوک', 'tamas-box' ); ?></button>
					<button type="button" class="button" data-tmb-chat="delete-webhook">🗑 <?php esc_html_e( 'حذف وب‌هوک', 'tamas-box' ); ?></button>
					<button type="button" class="button" data-tmb-chat="poll-now">⬇️ <?php esc_html_e( 'دریافت پیام‌های بله (دستی)', 'tamas-box' ); ?></button>
					<button type="button" class="button button-primary" data-tmb-chat="admin-link">🔗 <?php esc_html_e( 'لینک ثبت مدیر', 'tamas-box' ); ?></button>
					<button type="button" class="button" data-tmb-chat="item-first">⬆️ <?php esc_html_e( 'انتقال دکمه چت به اول فهرست', 'tamas-box' ); ?></button>
					<button type="button" class="button" data-tmb-chat="diag">🩺 <?php esc_html_e( 'گزارش عیب‌یابی', 'tamas-box' ); ?></button>
					<button type="button" class="button" data-tmb-chat="purge-cache">🧹 <?php esc_html_e( 'پاک کردن کش سایت', 'tamas-box' ); ?></button>
				</div>

				<p class="tmb-note">
					<strong><?php esc_html_e( 'گزارش در یک آدرس اینترنتی:', 'tamas-box' ); ?></strong>
					<?php esc_html_e( 'اگر دکمه بالا کار نکرد، این آدرس را در مرورگر باز کنید (باید وارد پیشخوان شده باشید)، سپس همه متن را انتخاب و کپی کنید:', 'tamas-box' ); ?>
					<br>
					<input type="text" readonly dir="ltr" style="width:100%;direction:ltr;font-family:monospace" onclick="this.select()"
						value="<?php echo esc_attr( add_query_arg( 'tmb_chat_report', '1', home_url( '/' ) ) ); ?>">
				</p>

				<p class="tmb-note">
					<strong><?php esc_html_e( 'گزارش در یک آدرس اینترنتی:', 'tamas-box' ); ?></strong>
					<?php esc_html_e( 'اگر دکمه بالا کار نکرد، این آدرس را در مرورگر باز کنید (باید وارد پیشخوان شده باشید)، سپس همه متن را انتخاب و کپی کنید:', 'tamas-box' ); ?>
					<br>
					<input type="text" readonly dir="ltr" style="width:100%;direction:ltr;font-family:monospace" onclick="this.select()"
						value="<?php echo esc_attr( add_query_arg( 'tmb_chat_report', '1', home_url( '/' ) ) ); ?>">
				</p>

				<div class="tmb-chat-result" data-tmb-chat-result hidden></div>

				<div class="tmb-field">
					<label><?php esc_html_e( 'آدرس وب‌هوک (خودکار ساخته می‌شود)', 'tamas-box' ); ?></label>
					<div class="tmb-webhook-row">
						<input type="text" class="ltr" id="tmb-webhook-url" value="<?php echo esc_attr( $webhook ); ?>" readonly onclick="this.select()" dir="ltr">
						<button type="button" class="button" data-tmb-chat="copy-webhook"><?php esc_html_e( 'کپی', 'tamas-box' ); ?></button>
					</div>
					<input type="hidden" name="<?php echo esc_attr( $n ); ?>[bale_secret]" value="<?php echo esc_attr( $c['bale_secret'] ); ?>">
					<p class="tmb-desc">
						<?php esc_html_e( 'کلید امنیتی داخل آدرس وب‌هوک قرار دارد؛ آن را در اختیار کسی نگذارید. با تغییر آن، وب‌هوک را دوباره ثبت کنید.', 'tamas-box' ); ?>
					</p>
					<?php if ( ! $https ) : ?>
						<p class="tmb-note tmb-note-warn">
							<?php esc_html_e( 'سایت شما با HTTPS باز نمی‌شود. بله فقط وب‌هوک HTTPS (پورت ۴۴۳ یا ۸۸) را قبول می‌کند؛ در غیر این صورت حالت «دریافت خودکار» را انتخاب کنید.', 'tamas-box' ); ?>
						</p>
					<?php endif; ?>
				</div>

				<div class="tmb-field">
					<label><?php esc_html_e( 'روش دریافت پاسخ مدیران', 'tamas-box' ); ?></label>
					<div class="tmb-radio-cards">
						<label class="tmb-radio-card <?php echo 'webhook' === $c['bale_mode'] ? 'selected' : ''; ?>">
							<input type="radio" name="<?php echo esc_attr( $n ); ?>[bale_mode]" value="webhook" <?php checked( $c['bale_mode'], 'webhook' ); ?>>
							<span class="tmb-rc-title"><?php esc_html_e( 'وب‌هوک (پیشنهادی)', 'tamas-box' ); ?></span>
							<span class="tmb-rc-desc"><?php esc_html_e( 'بله بلافاصله پیام مدیر را به سایت خبر می‌دهد؛ پاسخ آنی است.', 'tamas-box' ); ?></span>
						</label>
						<label class="tmb-radio-card <?php echo 'poll' === $c['bale_mode'] ? 'selected' : ''; ?>">
							<input type="radio" name="<?php echo esc_attr( $n ); ?>[bale_mode]" value="poll" <?php checked( $c['bale_mode'], 'poll' ); ?>>
							<span class="tmb-rc-title"><?php esc_html_e( 'دریافت خودکار (getUpdates)', 'tamas-box' ); ?></span>
							<span class="tmb-rc-desc"><?php esc_html_e( 'برای سایت‌های بدون HTTPS یا وقتی وب‌هوک کار نمی‌کند. کمی تأخیر دارد.', 'tamas-box' ); ?></span>
						</label>
					</div>
					<p class="tmb-desc">
						<?php
						printf(
							/* translators: %s: last webhook time */
							esc_html__( 'آخرین دریافت وب‌هوک: %s', 'tamas-box' ),
							! empty( $state['last_webhook'] )
								? '<code>' . esc_html( wp_date( 'Y/m/d H:i', (int) $state['last_webhook'] ) ) . '</code>'
								: '<code>—</code>'
						);
						?>
					</p>
				</div>

				<?php if ( ! empty( $error['message'] ) ) : ?>
					<p class="tmb-note tmb-note-warn">
						<strong><?php esc_html_e( 'آخرین خطای بله:', 'tamas-box' ); ?></strong>
						<code><?php echo esc_html( $error['message'] ); ?></code>
						<?php if ( ! empty( $error['time'] ) ) : ?>
							(<?php echo esc_html( wp_date( 'Y/m/d H:i', (int) $error['time'] ) ); ?>)
						<?php endif; ?>
					</p>
				<?php endif; ?>

				<?php if ( ! empty( $c['bale_bot_username'] ) ) : ?>
					<p class="tmb-note tmb-note-ok">
						<?php
						printf(
							/* translators: 1: bot name, 2: bot username */
							esc_html__( 'بازوی متصل: %1$s (@%2$s)', 'tamas-box' ),
							esc_html( $c['bale_bot_name'] ? $c['bale_bot_name'] : $c['bale_bot_username'] ),
							esc_html( $c['bale_bot_username'] )
						);
						?>
					</p>
				<?php endif; ?>

				<h4><?php esc_html_e( 'رفتار بازو', 'tamas-box' ); ?></h4>
				<div class="tmb-grid-2">
					<?php
					$behaviours = array(
						'bale_enabled'       => array( __( 'ارسال پیام‌ها به بله', 'tamas-box' ), __( 'اگر خاموش شود، گفتگوها فقط در پیشخوان سایت ذخیره می‌شوند.', 'tamas-box' ) ),
						'bale_notify_new'    => array( __( 'اعلان گفتگوی جدید', 'tamas-box' ), __( 'اولین پیام هر بازدیدکننده با جزئیات کامل ارسال می‌شود.', 'tamas-box' ) ),
						'bale_include_page'  => array( __( 'ارسال آدرس صفحه', 'tamas-box' ), __( 'مشخص می‌شود کاربر از کدام صفحه پیام داده است.', 'tamas-box' ) ),
						'bale_include_ip'    => array( __( 'ارسال IP کاربر', 'tamas-box' ), __( 'برای شناسایی کاربران مزاحم. توجه به حریم خصوصی داشته باشید.', 'tamas-box' ) ),
						'bale_default_reply' => array( __( 'پاسخ بدون کد = آخرین گفتگو', 'tamas-box' ), __( 'اگر مدیر بدون Reply و بدون کد پیام بنویسد، به تازه‌ترین گفتگوی باز می‌رود.', 'tamas-box' ) ),
						'bale_commands'      => array( __( 'فعال بودن دستورها', 'tamas-box' ), __( 'دستورهایی مثل /chats ، /reply ، /id', 'tamas-box' ) ),
						'bale_media'         => array( __( 'دریافت عکس و صوت از بله', 'tamas-box' ), __( 'فایل‌هایی که مدیر در بله می‌فرستد در سایت هم نمایش داده می‌شوند.', 'tamas-box' ) ),
						'bale_sync_admin'    => array( __( 'نمایش پاسخ‌های پیشخوان در بله', 'tamas-box' ), __( 'اگر از داخل وردپرس جواب بدهید، همان متن در بله هم ثبت می‌شود.', 'tamas-box' ) ),
						'only_admins_reply'  => array( __( 'فقط چت‌های معرفی‌شده مجازند', 'tamas-box' ), __( 'به افراد متفرقه که به بازو پیام دهند پاسخی داده نمی‌شود.', 'tamas-box' ) ),
					);
					foreach ( $behaviours as $key => $row ) :
						?>
						<div class="tmb-field tmb-switch-row">
							<label class="tmb-switch">
								<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[<?php echo esc_attr( $key ); ?>]" value="1" <?php checked( ! empty( $c[ $key ] ), 1 ); ?>>
								<span class="tmb-slider"></span>
							</label>
							<div>
								<strong><?php echo esc_html( $row[0] ); ?></strong>
								<p class="tmb-desc"><?php echo esc_html( $row[1] ); ?></p>
							</div>
						</div>
					<?php endforeach; ?>
				</div>

				<div class="tmb-helpbox">
					<strong><?php esc_html_e( 'راه‌اندازی در ۴ قدم', 'tamas-box' ); ?></strong>
					<ol>
						<li><?php esc_html_e( 'توکن بازو را وارد کنید و «تست اتصال» را بزنید (نام کاربری بازو و آدرس API خودکار ذخیره می‌شود).', 'tamas-box' ); ?></li>
						<li><?php esc_html_e( 'تنظیمات را «ذخیره تغییرات» کنید.', 'tamas-box' ); ?></li>
						<li><?php esc_html_e( '«لینک ثبت مدیر» را بزنید و لینک ساخته‌شده را در بله باز کنید → شناسه چت خودکار ثبت می‌شود. (راه جایگزین: پیام /id به بازو.)', 'tamas-box' ); ?></li>
						<li><?php esc_html_e( '«ثبت وب‌هوک» را بزنید. اگر سایت HTTPS نیست، روش دریافت را روی «دریافت خودکار» بگذارید.', 'tamas-box' ); ?></li>
						<li><?php esc_html_e( 'در سایت دکمه «چت آنلاین» را بزنید و یک پیام تستی بفرستید؛ باید در بله ظاهر شود. پاسخ شما در بله هم داخل چت سایت می‌آید.', 'tamas-box' ); ?></li>
						<li><?php esc_html_e( 'اگر چیزی کار نکرد، «گزارش عیب‌یابی» را بزنید و متن گزارش را برای پشتیبانی بفرستید.', 'tamas-box' ); ?></li>
					</ol>
				</div>
			</div>

			<!-- ============ دکمه و نمایش ============ -->
			<div class="tmb-card">
				<h3>💬 <?php esc_html_e( 'دکمه و نمایش', 'tamas-box' ); ?></h3>

				<div class="tmb-field">
					<label><?php esc_html_e( 'چطور چت باز شود؟', 'tamas-box' ); ?></label>
					<div class="tmb-radio-cards">
						<label class="tmb-radio-card <?php echo 'item' === $c['launcher'] ? 'selected' : ''; ?>">
							<input type="radio" name="<?php echo esc_attr( $n ); ?>[launcher]" value="item" <?php checked( $c['launcher'], 'item' ); ?>>
							<span class="tmb-rc-title"><?php esc_html_e( 'فقط به‌عنوان آیتم باکس تماس', 'tamas-box' ); ?></span>
							<span class="tmb-rc-desc"><?php esc_html_e( 'در تب «آیتم‌ها» هر باکس، دکمه «+ آیتم چت آنلاین» را بزنید.', 'tamas-box' ); ?></span>
						</label>
						<label class="tmb-radio-card <?php echo 'button' === $c['launcher'] ? 'selected' : ''; ?>">
							<input type="radio" name="<?php echo esc_attr( $n ); ?>[launcher]" value="button" <?php checked( $c['launcher'], 'button' ); ?>>
							<span class="tmb-rc-title"><?php esc_html_e( 'فقط دکمه شناور چت', 'tamas-box' ); ?></span>
							<span class="tmb-rc-desc"><?php esc_html_e( 'یک دکمه مستقل روی صفحه نمایش داده می‌شود.', 'tamas-box' ); ?></span>
						</label>
						<label class="tmb-radio-card <?php echo 'both' === $c['launcher'] ? 'selected' : ''; ?>">
							<input type="radio" name="<?php echo esc_attr( $n ); ?>[launcher]" value="both" <?php checked( $c['launcher'], 'both' ); ?>>
							<span class="tmb-rc-title"><?php esc_html_e( 'هر دو', 'tamas-box' ); ?></span>
							<span class="tmb-rc-desc"><?php esc_html_e( 'هم آیتم داخل باکس، هم دکمه شناور مستقل.', 'tamas-box' ); ?></span>
						</label>
					</div>
				</div>

				<div class="tmb-grid-3">
					<div class="tmb-field">
						<label><?php esc_html_e( 'موقعیت دکمه شناور', 'tamas-box' ); ?></label>
						<select name="<?php echo esc_attr( $n ); ?>[launcher_position]">
							<?php foreach ( TMB_Settings::positions() as $key => $label ) : ?>
								<option value="<?php echo esc_attr( $key ); ?>" <?php selected( $c['launcher_position'], $key ); ?>><?php echo esc_html( $label ); ?></option>
							<?php endforeach; ?>
						</select>
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'فاصله افقی (px)', 'tamas-box' ); ?></label>
						<input type="number" min="0" max="400" name="<?php echo esc_attr( $n ); ?>[launcher_offset_x]" value="<?php echo esc_attr( $c['launcher_offset_x'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'فاصله عمودی دسکتاپ (px)', 'tamas-box' ); ?></label>
						<input type="number" min="0" max="400" name="<?php echo esc_attr( $n ); ?>[launcher_offset_y]" value="<?php echo esc_attr( $c['launcher_offset_y'] ); ?>">
					</div>
				</div>

				<div class="tmb-grid-3">
					<div class="tmb-field">
						<label><?php esc_html_e( 'فاصله از پایین در موبایل (px)', 'tamas-box' ); ?></label>
						<input type="number" min="0" max="240" name="<?php echo esc_attr( $n ); ?>[launcher_mobile_y]" value="<?php echo esc_attr( $c['launcher_mobile_y'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'متن دکمه', 'tamas-box' ); ?></label>
						<input type="text" name="<?php echo esc_attr( $n ); ?>[launcher_text]" value="<?php echo esc_attr( $c['launcher_text'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'آیکون دکمه', 'tamas-box' ); ?></label>
						<select name="<?php echo esc_attr( $n ); ?>[launcher_icon]">
							<?php foreach ( $icons as $key => $data ) : ?>
								<option value="<?php echo esc_attr( $key ); ?>" <?php selected( $c['launcher_icon'], $key ); ?>><?php echo esc_html( $data['label'] ); ?></option>
							<?php endforeach; ?>
						</select>
					</div>
				</div>

				<div class="tmb-grid-3">
					<div class="tmb-field">
						<label><?php esc_html_e( 'رنگ اصلی دکمه', 'tamas-box' ); ?></label>
						<input type="text" class="tmb-color" name="<?php echo esc_attr( $n ); ?>[launcher_color_1]" value="<?php echo esc_attr( $c['launcher_color_1'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'رنگ دوم (گرادیانت)', 'tamas-box' ); ?></label>
						<input type="text" class="tmb-color" name="<?php echo esc_attr( $n ); ?>[launcher_color_2]" value="<?php echo esc_attr( $c['launcher_color_2'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'رنگ آیکون دکمه', 'tamas-box' ); ?></label>
						<input type="text" class="tmb-color" name="<?php echo esc_attr( $n ); ?>[launcher_fg]" value="<?php echo esc_attr( $c['launcher_fg'] ); ?>">
					</div>
				</div>

				<div class="tmb-grid-3">
					<?php
					$toggles = array(
						'launcher_show_text' => __( 'نمایش متن روی دکمه', 'tamas-box' ),
						'launcher_pulse'     => __( 'انیمیشن تپش دکمه', 'tamas-box' ),
						'badge'              => __( 'نشان پیام نخوانده', 'tamas-box' ),
						'sound'              => __( 'صدای پیام جدید', 'tamas-box' ),
						'auto_open'          => __( 'باز شدن خودکار چت', 'tamas-box' ),
						'powered_by'         => __( 'نمایش نوار پایین پنجره', 'tamas-box' ),
						'allow_new_chat'     => __( 'دکمه «گفتگوی جدید» برای کاربر', 'tamas-box' ),
						'require_login'      => __( 'فقط کاربران وارد شده چت کنند', 'tamas-box' ),
					);
					foreach ( $toggles as $key => $label ) :
						?>
						<div class="tmb-field tmb-switch-row">
							<label class="tmb-switch">
								<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[<?php echo esc_attr( $key ); ?>]" value="1" <?php checked( ! empty( $c[ $key ] ), 1 ); ?>>
								<span class="tmb-slider"></span>
							</label>
							<div><strong><?php echo esc_html( $label ); ?></strong></div>
						</div>
					<?php endforeach; ?>
				</div>

				<div class="tmb-grid-3">
					<div class="tmb-field">
						<label><?php esc_html_e( 'تأخیر باز شدن خودکار (ثانیه)', 'tamas-box' ); ?></label>
						<input type="number" min="0" max="300" name="<?php echo esc_attr( $n ); ?>[auto_open_delay]" value="<?php echo esc_attr( $c['auto_open_delay'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'فاصله بررسی پیام جدید (ثانیه)', 'tamas-box' ); ?></label>
						<input type="number" min="2" max="60" name="<?php echo esc_attr( $n ); ?>[poll_interval]" value="<?php echo esc_attr( $c['poll_interval'] ); ?>">
						<p class="tmb-desc"><?php esc_html_e( 'وقتی چت باز است. عدد کمتر = پاسخ سریع‌تر، فشار بیشتر روی سرور.', 'tamas-box' ); ?></p>
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'بررسی در حالت بسته (ثانیه)', 'tamas-box' ); ?></label>
						<input type="number" min="10" max="600" name="<?php echo esc_attr( $n ); ?>[poll_closed]" value="<?php echo esc_attr( $c['poll_closed'] ); ?>">
					</div>
				</div>
			</div>

			<!-- ============ متن‌ها ============ -->
			<div class="tmb-card">
				<h3>✍️ <?php esc_html_e( 'متن‌ها', 'tamas-box' ); ?></h3>

				<div class="tmb-grid-2">
					<div class="tmb-field">
						<label><?php esc_html_e( 'عنوان پنجره چت', 'tamas-box' ); ?></label>
						<input type="text" name="<?php echo esc_attr( $n ); ?>[title]" value="<?php echo esc_attr( $c['title'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'زیرعنوان', 'tamas-box' ); ?></label>
						<input type="text" name="<?php echo esc_attr( $n ); ?>[subtitle]" value="<?php echo esc_attr( $c['subtitle'] ); ?>">
					</div>
				</div>

				<div class="tmb-field">
					<label><?php esc_html_e( 'پیام خوش‌آمد (اولین پیام گفتگو)', 'tamas-box' ); ?></label>
					<textarea rows="3" name="<?php echo esc_attr( $n ); ?>[greeting]"><?php echo esc_textarea( $c['greeting'] ); ?></textarea>
				</div>

				<div class="tmb-grid-2">
					<div class="tmb-field">
						<label><?php esc_html_e( 'متن داخل کادر نوشتن', 'tamas-box' ); ?></label>
						<input type="text" name="<?php echo esc_attr( $n ); ?>[placeholder]" value="<?php echo esc_attr( $c['placeholder'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'متن دکمه ارسال', 'tamas-box' ); ?></label>
						<input type="text" name="<?php echo esc_attr( $n ); ?>[send_label]" value="<?php echo esc_attr( $c['send_label'] ); ?>">
					</div>
				</div>

				<div class="tmb-grid-2">
					<div class="tmb-field">
						<label><?php esc_html_e( 'نام پشتیبانی', 'tamas-box' ); ?></label>
						<input type="text" name="<?php echo esc_attr( $n ); ?>[agent_label]" value="<?php echo esc_attr( $c['agent_label'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'نام کاربر در چت', 'tamas-box' ); ?></label>
						<input type="text" name="<?php echo esc_attr( $n ); ?>[visitor_label]" value="<?php echo esc_attr( $c['visitor_label'] ); ?>">
					</div>
				</div>

				<div class="tmb-grid-2">
					<div class="tmb-field">
						<label><?php esc_html_e( 'متن وضعیت آنلاین', 'tamas-box' ); ?></label>
						<input type="text" name="<?php echo esc_attr( $n ); ?>[online_text]" value="<?php echo esc_attr( $c['online_text'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'متن وضعیت آفلاین', 'tamas-box' ); ?></label>
						<input type="text" name="<?php echo esc_attr( $n ); ?>[offline_text]" value="<?php echo esc_attr( $c['offline_text'] ); ?>">
					</div>
				</div>

				<div class="tmb-field">
					<label><?php esc_html_e( 'پیام «الان آنلاین نیستیم»', 'tamas-box' ); ?></label>
					<textarea rows="2" name="<?php echo esc_attr( $n ); ?>[offline_notice]"><?php echo esc_textarea( $c['offline_notice'] ); ?></textarea>
				</div>

				<div class="tmb-grid-2">
					<div class="tmb-field">
						<label><?php esc_html_e( 'پیام بسته شدن گفتگو', 'tamas-box' ); ?></label>
						<textarea rows="2" name="<?php echo esc_attr( $n ); ?>[closed_notice]"><?php echo esc_textarea( $c['closed_notice'] ); ?></textarea>
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'پیام محدودیت ارسال', 'tamas-box' ); ?></label>
						<textarea rows="2" name="<?php echo esc_attr( $n ); ?>[rate_notice]"><?php echo esc_textarea( $c['rate_notice'] ); ?></textarea>
					</div>
				</div>

				<div class="tmb-field">
					<label><?php esc_html_e( 'متن «در حال نوشتن»', 'tamas-box' ); ?></label>
					<input type="text" name="<?php echo esc_attr( $n ); ?>[typing_text]" value="<?php echo esc_attr( $c['typing_text'] ); ?>">
				</div>
			</div>

			<!-- ============ فرم پیش از گفتگو ============ -->
			<div class="tmb-card">
				<h3>📝 <?php esc_html_e( 'فرم پیش از گفتگو', 'tamas-box' ); ?></h3>
				<p class="tmb-desc"><?php esc_html_e( 'اگر روشن باشد، بازدیدکننده قبل از چت نام و شماره تماس خود را وارد می‌کند؛ این اطلاعات همراه اولین پیام به بله فرستاده می‌شود.', 'tamas-box' ); ?></p>

				<div class="tmb-grid-3">
					<div class="tmb-field tmb-switch-row">
						<label class="tmb-switch">
							<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[prechat_enabled]" value="1" <?php checked( $c['prechat_enabled'], 1 ); ?>>
							<span class="tmb-slider"></span>
						</label>
						<div><strong><?php esc_html_e( 'فعال', 'tamas-box' ); ?></strong></div>
					</div>
					<div class="tmb-field tmb-switch-row">
						<label class="tmb-switch">
							<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[prechat_name]" value="1" <?php checked( $c['prechat_name'], 1 ); ?>>
							<span class="tmb-slider"></span>
						</label>
						<div><strong><?php esc_html_e( 'فیلد نام', 'tamas-box' ); ?></strong></div>
					</div>
					<div class="tmb-field tmb-switch-row">
						<label class="tmb-switch">
							<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[prechat_phone]" value="1" <?php checked( $c['prechat_phone'], 1 ); ?>>
							<span class="tmb-slider"></span>
						</label>
						<div><strong><?php esc_html_e( 'فیلد شماره تماس', 'tamas-box' ); ?></strong></div>
					</div>
				</div>

				<div class="tmb-field tmb-switch-row">
					<label class="tmb-switch">
						<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[prechat_required]" value="1" <?php checked( $c['prechat_required'], 1 ); ?>>
						<span class="tmb-slider"></span>
					</label>
					<div><strong><?php esc_html_e( 'پر کردن فرم اجباری باشد', 'tamas-box' ); ?></strong></div>
				</div>

				<div class="tmb-grid-3">
					<div class="tmb-field">
						<label><?php esc_html_e( 'عنوان فرم', 'tamas-box' ); ?></label>
						<input type="text" name="<?php echo esc_attr( $n ); ?>[prechat_title]" value="<?php echo esc_attr( $c['prechat_title'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'برچسب فیلد نام', 'tamas-box' ); ?></label>
						<input type="text" name="<?php echo esc_attr( $n ); ?>[prechat_name_label]" value="<?php echo esc_attr( $c['prechat_name_label'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'برچسب فیلد تماس', 'tamas-box' ); ?></label>
						<input type="text" name="<?php echo esc_attr( $n ); ?>[prechat_phone_label]" value="<?php echo esc_attr( $c['prechat_phone_label'] ); ?>">
					</div>
				</div>

				<div class="tmb-field">
					<label><?php esc_html_e( 'متن دکمه شروع', 'tamas-box' ); ?></label>
					<input type="text" name="<?php echo esc_attr( $n ); ?>[prechat_button]" value="<?php echo esc_attr( $c['prechat_button'] ); ?>">
				</div>
			</div>

			<!-- ============ ساعات پاسخگویی ============ -->
			<div class="tmb-card">
				<h3>⏰ <?php esc_html_e( 'ساعات پاسخگویی', 'tamas-box' ); ?></h3>
				<p class="tmb-desc"><?php esc_html_e( 'خارج از این ساعت‌ها، چت با وضعیت «آفلاین» نمایش داده می‌شود اما پیام کاربر همچنان ذخیره و به بله ارسال می‌شود.', 'tamas-box' ); ?></p>

				<div class="tmb-field tmb-switch-row">
					<label class="tmb-switch">
						<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[hours_enabled]" value="1" <?php checked( $c['hours_enabled'], 1 ); ?>>
						<span class="tmb-slider"></span>
					</label>
					<div><strong><?php esc_html_e( 'محدود کردن به ساعات کاری', 'tamas-box' ); ?></strong></div>
				</div>

				<div class="tmb-field">
					<label><?php esc_html_e( 'روزهای هفته', 'tamas-box' ); ?></label>
					<div class="tmb-checkgrid tmb-daygrid">
						<?php foreach ( $days as $key => $label ) : ?>
							<label class="tmb-checkchip">
								<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[hours_days][]" value="<?php echo esc_attr( $key ); ?>" <?php checked( in_array( $key, (array) $c['hours_days'], true ) ); ?>>
								<span><?php echo esc_html( $label ); ?></span>
							</label>
						<?php endforeach; ?>
					</div>
					<p class="tmb-desc"><?php esc_html_e( 'خالی یعنی همه روزها.', 'tamas-box' ); ?></p>
				</div>

				<div class="tmb-grid-2">
					<div class="tmb-field">
						<label><?php esc_html_e( 'از ساعت', 'tamas-box' ); ?></label>
						<input type="time" class="ltr" name="<?php echo esc_attr( $n ); ?>[hours_from]" value="<?php echo esc_attr( $c['hours_from'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'تا ساعت', 'tamas-box' ); ?></label>
						<input type="time" class="ltr" name="<?php echo esc_attr( $n ); ?>[hours_to]" value="<?php echo esc_attr( $c['hours_to'] ); ?>">
					</div>
				</div>
				<p class="tmb-desc">
					<?php
					printf(
						/* translators: %s: current site time */
						esc_html__( 'ساعت فعلی سایت: %s', 'tamas-box' ),
						'<code>' . esc_html( current_time( 'H:i' ) ) . '</code>'
					);
					?>
				</p>
			</div>

			<!-- ============ ظاهر پنجره چت ============ -->
			<div class="tmb-card">
				<h3>🎨 <?php esc_html_e( 'ظاهر پنجره چت', 'tamas-box' ); ?></h3>

				<div class="tmb-grid-3">
					<div class="tmb-field">
						<label><?php esc_html_e( 'عرض (px)', 'tamas-box' ); ?></label>
						<input type="number" min="280" max="640" name="<?php echo esc_attr( $n ); ?>[width]" value="<?php echo esc_attr( $c['width'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'ارتفاع (px)', 'tamas-box' ); ?></label>
						<input type="number" min="320" max="900" name="<?php echo esc_attr( $n ); ?>[height]" value="<?php echo esc_attr( $c['height'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'گردی گوشه‌ها (px)', 'tamas-box' ); ?></label>
						<input type="number" min="0" max="40" name="<?php echo esc_attr( $n ); ?>[radius]" value="<?php echo esc_attr( $c['radius'] ); ?>">
					</div>
				</div>

				<div class="tmb-grid-3">
					<div class="tmb-field">
						<label><?php esc_html_e( 'رنگ سربرگ', 'tamas-box' ); ?></label>
						<input type="text" class="tmb-color" name="<?php echo esc_attr( $n ); ?>[header_bg]" value="<?php echo esc_attr( $c['header_bg'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'رنگ متن سربرگ', 'tamas-box' ); ?></label>
						<input type="text" class="tmb-color" name="<?php echo esc_attr( $n ); ?>[header_text]" value="<?php echo esc_attr( $c['header_text'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'پس‌زمینه پنجره', 'tamas-box' ); ?></label>
						<input type="text" class="tmb-color" name="<?php echo esc_attr( $n ); ?>[panel_bg]" value="<?php echo esc_attr( $c['panel_bg'] ); ?>">
					</div>
				</div>

				<div class="tmb-grid-3">
					<div class="tmb-field">
						<label><?php esc_html_e( 'حباب پیام کاربر', 'tamas-box' ); ?></label>
						<input type="text" class="tmb-color" name="<?php echo esc_attr( $n ); ?>[bubble_visitor]" value="<?php echo esc_attr( $c['bubble_visitor'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'متن حباب کاربر', 'tamas-box' ); ?></label>
						<input type="text" class="tmb-color" name="<?php echo esc_attr( $n ); ?>[bubble_visitor_text]" value="<?php echo esc_attr( $c['bubble_visitor_text'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'رنگ تأکید', 'tamas-box' ); ?></label>
						<input type="text" class="tmb-color" name="<?php echo esc_attr( $n ); ?>[accent]" value="<?php echo esc_attr( $c['accent'] ); ?>">
					</div>
				</div>

				<div class="tmb-grid-3">
					<div class="tmb-field">
						<label><?php esc_html_e( 'حباب پیام پشتیبانی', 'tamas-box' ); ?></label>
						<input type="text" class="tmb-color" name="<?php echo esc_attr( $n ); ?>[bubble_agent]" value="<?php echo esc_attr( $c['bubble_agent'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'متن حباب پشتیبانی', 'tamas-box' ); ?></label>
						<input type="text" class="tmb-color" name="<?php echo esc_attr( $n ); ?>[bubble_agent_text]" value="<?php echo esc_attr( $c['bubble_agent_text'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'رنگ متن کم‌رنگ', 'tamas-box' ); ?></label>
						<input type="text" class="tmb-color" name="<?php echo esc_attr( $n ); ?>[text_muted]" value="<?php echo esc_attr( $c['text_muted'] ); ?>">
					</div>
				</div>

				<div class="tmb-preset-row">
					<?php
					$chat_presets = array(
						array( '#c99a5b', '#a97c3f', '#ffffff', '#f6f7f9' ),
						array( '#22c55e', '#16a34a', '#ffffff', '#f4f7f5' ),
						array( '#1BA5E1', '#0f7fb0', '#ffffff', '#f2f8fc' ),
						array( '#6366f1', '#4f46e5', '#ffffff', '#f5f5fb' ),
						array( '#0f172a', '#334155', '#fbbf24', '#f4f4f5' ),
						array( '#e11d48', '#be123c', '#ffffff', '#fdf4f6' ),
					);
					foreach ( $chat_presets as $preset ) :
						?>
						<button type="button" class="tmb-color-preset" data-tmb-chat-preset
							data-accent="<?php echo esc_attr( $preset[0] ); ?>"
							data-head="<?php echo esc_attr( $preset[0] ); ?>"
							data-head2="<?php echo esc_attr( $preset[1] ); ?>"
							data-fg="<?php echo esc_attr( $preset[2] ); ?>"
							data-panel="<?php echo esc_attr( $preset[3] ); ?>"
							title="<?php esc_attr_e( 'اعمال این رنگ', 'tamas-box' ); ?>"
							style="background:linear-gradient(135deg,<?php echo esc_attr( $preset[0] ); ?>,<?php echo esc_attr( $preset[1] ); ?>)"></button>
					<?php endforeach; ?>
				</div>
			</div>

			<!-- ============ امنیت ============ -->
			<div class="tmb-card">
				<h3>🛡 <?php esc_html_e( 'امنیت و نگهداری', 'tamas-box' ); ?></h3>

				<div class="tmb-grid-3">
					<div class="tmb-field">
						<label><?php esc_html_e( 'حداکثر طول پیام', 'tamas-box' ); ?></label>
						<input type="number" min="50" max="4000" name="<?php echo esc_attr( $n ); ?>[max_length]" value="<?php echo esc_attr( $c['max_length'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'حداکثر پیام در بازه', 'tamas-box' ); ?></label>
						<input type="number" min="1" max="120" name="<?php echo esc_attr( $n ); ?>[rate_limit]" value="<?php echo esc_attr( $c['rate_limit'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'بازه زمانی (ثانیه)', 'tamas-box' ); ?></label>
						<input type="number" min="10" max="3600" name="<?php echo esc_attr( $n ); ?>[rate_window]" value="<?php echo esc_attr( $c['rate_window'] ); ?>">
					</div>
				</div>

				<div class="tmb-grid-2">
					<div class="tmb-field">
						<label><?php esc_html_e( 'نگهداری گفتگوها (روز)', 'tamas-box' ); ?></label>
						<input type="number" min="1" max="3650" name="<?php echo esc_attr( $n ); ?>[retain_days]" value="<?php echo esc_attr( $c['retain_days'] ); ?>">
						<p class="tmb-desc"><?php esc_html_e( 'گفتگوهای قدیمی‌تر به‌صورت خودکار پاک می‌شوند.', 'tamas-box' ); ?></p>
					</div>
					<div class="tmb-field tmb-switch-row">
						<label class="tmb-switch">
							<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[delete_on_uninstall]" value="1" <?php checked( $c['delete_on_uninstall'], 1 ); ?>>
							<span class="tmb-slider"></span>
						</label>
						<div>
							<strong><?php esc_html_e( 'حذف گفتگوها هنگام حذف افزونه', 'tamas-box' ); ?></strong>
							<p class="tmb-desc"><?php esc_html_e( 'جدول‌ها و فایل‌های چت از دیتابیس پاک می‌شوند.', 'tamas-box' ); ?></p>
						</div>
					</div>
				</div>

				<?php
				$counters = TMB_Chat_DB::counters();
				?>
				<p class="tmb-note">
					<strong><?php esc_html_e( 'وضعیت فعلی:', 'tamas-box' ); ?></strong>
					<?php
					printf(
						/* translators: 1: open chats, 2: unanswered */
						esc_html__( '%1$s گفتگوی باز، %2$s گفتگوی بی‌پاسخ', 'tamas-box' ),
						'<code>' . (int) $counters['open'] . '</code>',
						'<code>' . (int) $counters['unread'] . '</code>'
					);
					?>
					—
					<a href="<?php echo esc_url( admin_url( 'admin.php?page=' . self::INBOX_SLUG ) ); ?>"><?php esc_html_e( 'باز کردن صندوق گفتگوها', 'tamas-box' ); ?></a>
				</p>

				<?php if ( ! $ready ) : ?>
					<p class="tmb-note tmb-note-warn">
						<?php esc_html_e( 'اتصال بله کامل نیست: توکن و شناسه چت مدیران را وارد کنید تا پیام‌ها به بله برسند. تا قبل از آن، گفتگوها فقط در پیشخوان سایت ذخیره می‌شوند.', 'tamas-box' ); ?>
					</p>
				<?php endif; ?>
			</div>
		</section>
		<?php
	}

	/* ---------------------------------------------------------------------
	 * Inbox
	 * ------------------------------------------------------------------ */

	/**
	 * The conversations inbox.
	 *
	 * @return void
	 */
	public function render_inbox() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		TMB_Chat_DB::maybe_install();

		$enabled  = TMB_Chat::enabled();
		$counters = TMB_Chat_DB::counters();
		$bale     = TMB_Chat_Bale::is_ready();
		?>
		<div class="wrap tmb-wrap tmb-inbox-wrap" dir="rtl">
			<h1 class="tmb-title">
				<span class="tmb-logo">تب</span>
				<?php esc_html_e( 'گفتگوهای آنلاین', 'tamas-box' ); ?>
				<span class="tmb-ver">v<?php echo esc_html( TMB_VERSION ); ?></span>
			</h1>

			<?php if ( ! $enabled ) : ?>
				<div class="notice notice-warning">
					<p>
						<?php esc_html_e( 'چت آنلاین خاموش است.', 'tamas-box' ); ?>
						<a href="<?php echo esc_url( admin_url( 'admin.php?page=tamas-box#tab-chat' ) ); ?>"><?php esc_html_e( 'فعال کردن و تنظیمات', 'tamas-box' ); ?></a>
					</p>
				</div>
			<?php elseif ( ! $bale ) : ?>
				<div class="notice notice-info">
					<p>
						<?php esc_html_e( 'بازه (بله) هنوز متصل نیست؛ گفتگوها فقط در همین‌جا ذخیره می‌شوند.', 'tamas-box' ); ?>
						<a href="<?php echo esc_url( admin_url( 'admin.php?page=tamas-box#tab-chat' ) ); ?>"><?php esc_html_e( 'اتصال به بله', 'tamas-box' ); ?></a>
					</p>
				</div>
			<?php endif; ?>

			<div class="tmb-inbox" id="tmb-inbox">
				<aside class="tmb-inbox-side">
					<div class="tmb-inbox-filters">
						<button type="button" class="tmb-inbox-filter active" data-filter=""><?php esc_html_e( 'همه', 'tamas-box' ); ?></button>
						<button type="button" class="tmb-inbox-filter" data-filter="open"><?php esc_html_e( 'باز', 'tamas-box' ); ?> <span class="tmb-count" data-count-open><?php echo (int) $counters['open']; ?></span></button>
						<button type="button" class="tmb-inbox-filter" data-filter="unread">🔴 <?php esc_html_e( 'بی‌پاسخ', 'tamas-box' ); ?> <span class="tmb-count" data-count-unread><?php echo (int) $counters['unread']; ?></span></button>
						<button type="button" class="tmb-inbox-filter" data-filter="closed"><?php esc_html_e( 'بسته', 'tamas-box' ); ?></button>
					</div>

					<div class="tmb-inbox-search">
						<input type="search" id="tmb-inbox-search" placeholder="<?php esc_attr_e( 'جستجو در نام، شماره، پیام…', 'tamas-box' ); ?>">
					</div>

					<div class="tmb-inbox-list" id="tmb-inbox-list" role="listbox" aria-label="<?php esc_attr_e( 'گفتگوها', 'tamas-box' ); ?>">
						<p class="tmb-inbox-loading"><?php esc_html_e( 'در حال بارگذاری…', 'tamas-box' ); ?></p>
					</div>

					<div class="tmb-inbox-pager">
						<button type="button" class="button" id="tmb-inbox-prev" disabled>‹ <?php esc_html_e( 'قبلی', 'tamas-box' ); ?></button>
						<span id="tmb-inbox-pageinfo">1</span>
						<button type="button" class="button" id="tmb-inbox-next" disabled><?php esc_html_e( 'بعدی', 'tamas-box' ); ?> ›</button>
					</div>
				</aside>

				<section class="tmb-inbox-main">
					<div class="tmb-inbox-empty" id="tmb-inbox-empty">
						<span class="tmb-inbox-empty-ico">💬</span>
						<p><?php esc_html_e( 'یک گفتگو را از فهرست انتخاب کنید.', 'tamas-box' ); ?></p>
					</div>

					<div class="tmb-inbox-thread" id="tmb-inbox-thread" hidden>
						<header class="tmb-thread-head">
							<div class="tmb-thread-id">
								<strong data-thread-name>—</strong>
								<span data-thread-meta></span>
							</div>
							<div class="tmb-thread-actions">
								<button type="button" class="button" data-thread-status><?php esc_html_e( 'بستن گفتگو', 'tamas-box' ); ?></button>
								<a class="button" data-thread-page href="#" target="_blank" rel="noopener"><?php esc_html_e( 'صفحه کاربر', 'tamas-box' ); ?></a>
								<button type="button" class="button button-link-delete" data-thread-delete><?php esc_html_e( 'حذف', 'tamas-box' ); ?></button>
							</div>
						</header>

						<div class="tmb-thread-info" data-thread-info></div>

						<div class="tmb-thread-body" id="tmb-thread-body" role="log"></div>

						<form class="tmb-thread-composer" id="tmb-thread-composer">
							<textarea id="tmb-thread-input" rows="2" placeholder="<?php esc_attr_e( 'پاسخ خود را بنویسید… (Enter برای ارسال، Shift+Enter برای خط جدید)', 'tamas-box' ); ?>"></textarea>
							<div class="tmb-thread-composer-actions">
								<span class="tmb-thread-hint"><?php esc_html_e( 'پاسخ شما هم در سایت و هم در بله ثبت می‌شود.', 'tamas-box' ); ?></span>
								<button type="submit" class="button button-primary button-hero"><?php esc_html_e( 'ارسال پاسخ', 'tamas-box' ); ?></button>
							</div>
						</form>
					</div>
				</section>
			</div>
		</div>
		<?php
	}

	/* ---------------------------------------------------------------------
	 * AJAX
	 * ------------------------------------------------------------------ */

	/**
	 * Guard for every AJAX call.
	 *
	 * @return void
	 */
	protected function guard() {
		check_ajax_referer( 'tmb_chat_admin', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( array( 'message' => __( 'اجازه دسترسی ندارید.', 'tamas-box' ) ), 403 );
		}
	}

	/**
	 * Read the bot settings straight from the submitted form so the admin can
	 * test before saving.
	 *
	 * @return array { token, base }
	 */
	protected function submitted_bot() {
		$token = isset( $_POST['token'] ) ? sanitize_text_field( wp_unslash( $_POST['token'] ) ) : '';
		$base  = isset( $_POST['base'] ) ? esc_url_raw( wp_unslash( $_POST['base'] ) ) : '';

		if ( '' === $token || '' === $base ) {
			$c     = TMB_Settings::chat();
			$token = $token ? $token : $c['bale_token'];
			$base  = $base ? $base : $c['bale_api_base'];
		}

		return array(
			'token' => trim( (string) $token ),
			'base'  => untrailingslashit( (string) $base ),
		);
	}

	/**
	 * Call one method with the submitted (unsaved) credentials.
	 *
	 * @param string $method Method.
	 * @param array  $args   Arguments.
	 * @return array|WP_Error
	 */
	protected function call_with_submitted( $method, $args = array() ) {
		$bot = $this->submitted_bot();

		if ( '' === $bot['token'] ) {
			return new WP_Error( 'tmb_no_token', __( 'ابتدا توکن بازو را وارد کنید.', 'tamas-box' ) );
		}

		$response = wp_remote_post(
			self::bot_endpoint( $bot['base'], $bot['token'], $method ),
			array(
				'timeout' => 25,
				'headers' => array( 'Content-Type' => 'application/json' ),
				'body'    => wp_json_encode( $args ),
			)
		);

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$body = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( ! is_array( $body ) ) {
			return new WP_Error( 'tmb_bad_response', __( 'پاسخ نامعتبر از سرور بله.', 'tamas-box' ) );
		}

		if ( empty( $body['ok'] ) ) {
			return new WP_Error(
				'tmb_bale_error',
				isset( $body['description'] ) ? $body['description'] : __( 'خطای نامشخص.', 'tamas-box' )
			);
		}

		return $body;
	}

	/**
	 * Build a Bale API url: <base><token>/<method>.
	 *
	 * The token is part of the path - without it Bale answers "Not Found".
	 *
	 * @param string $base   API base, e.g. https://tapi.bale.ai/bot
	 * @param string $token  Bot token.
	 * @param string $method Method name.
	 * @return string
	 */
	public static function bot_endpoint( $base, $token, $method ) {
		return untrailingslashit( (string) $base ) . trim( (string) $token ) . '/' . ltrim( (string) $method, '/' );
	}

	/**
	 * Test the token with getMe (tries both API bases when needed).
	 *
	 * @return void
	 */
	public function ajax_test() {
		$this->guard();

		$bot    = $this->submitted_bot();
		$bases  = array( $bot['base'], 'https://tapi.bale.ai/bot', 'https://tapi.bale.ai/business/bot' );
		$result = null;
		$used   = '';
		$tried  = array();

		if ( '' === $bot['token'] ) {
			wp_send_json_error( array( 'message' => __( 'ابتدا توکن بازو را وارد کنید (از @botfather در بله).', 'tamas-box' ) ) );
		}

		foreach ( array_unique( array_filter( $bases ) ) as $base ) {
			$base    = untrailingslashit( $base );
			$tried[] = $base . '****/' . 'getMe';

			$response = wp_remote_post(
				self::bot_endpoint( $base, $bot['token'], 'getMe' ),
				array(
					'timeout' => 20,
					'headers' => array( 'Content-Type' => 'application/json' ),
					'body'    => '{}',
				)
			);

			if ( is_wp_error( $response ) ) {
				$result = $response;
				continue;
			}

			$body = json_decode( wp_remote_retrieve_body( $response ), true );

			if ( is_array( $body ) && ! empty( $body['ok'] ) ) {
				$result = $body;
				$used   = $base;
				break;
			}

			$code = is_array( $body ) && isset( $body['error_code'] ) ? (int) $body['error_code'] : (int) wp_remote_retrieve_response_code( $response );

			$result = new WP_Error(
				'tmb_bale_error',
				( is_array( $body ) && isset( $body['description'] ) ? $body['description'] : __( 'پاسخ نامعتبر.', 'tamas-box' ) )
					. ' (HTTP ' . $code . ')'
			);
		}

		if ( is_wp_error( $result ) ) {
			wp_send_json_error(
				array(
					'message' => $result->get_error_message(),
					'hint'    => __( 'آدرس‌هایی که امتحان شد: ', 'tamas-box' ) . implode( ' , ', $tried )
						. "\n" . __( 'اگر «Not Found» می‌بینید، توکن اشتباه یا ناقص است؛ قالب درست: 123456789:abcdIuZmK5...', 'tamas-box' ),
				)
			);
		}

		$botinfo = isset( $result['result'] ) ? $result['result'] : array();

		/* Remember the working base + bot identity so the rest of the plugin agrees. */
		$raw = get_option( TMB_OPTION, array() );
		if ( is_array( $raw ) ) {
			if ( ! isset( $raw['chat'] ) || ! is_array( $raw['chat'] ) ) {
				$raw['chat'] = array();
			}
			if ( $used ) {
				$raw['chat']['bale_api_base'] = $used;
			}
			if ( ! empty( $botinfo['username'] ) ) {
				$raw['chat']['bale_bot_username'] = sanitize_text_field( $botinfo['username'] );
			}
			if ( ! empty( $botinfo['first_name'] ) ) {
				$raw['chat']['bale_bot_name'] = sanitize_text_field( $botinfo['first_name'] );
			}
			update_option( TMB_OPTION, $raw );
			TMB_Chat::reset_cfg_cache();
		}

		TMB_Chat_DB::set_state( 'bot_username', isset( $botinfo['username'] ) ? $botinfo['username'] : '' );
		TMB_Chat_DB::set_state( 'bot_name', isset( $botinfo['first_name'] ) ? $botinfo['first_name'] : '' );

		wp_send_json_success(
			array(
				'message'  => sprintf(
					/* translators: 1: bot name, 2: bot username */
					__( 'اتصال برقرار است ✔ — بازو: %1$s (@%2$s)', 'tamas-box' ),
					isset( $botinfo['first_name'] ) ? $botinfo['first_name'] : '?',
					isset( $botinfo['username'] ) ? $botinfo['username'] : '?'
				),
				'base'     => $used,
				'bot'      => $botinfo,
				'business' => ( false !== strpos( (string) $used, '/business/' ) ) ? 1 : 0,
				'hint'     => __( 'آدرس API و نام کاربری بازو در تنظیمات ذخیره شد؛ صفحه را تازه کنید.', 'tamas-box' ),
			)
		);
	}

	/**
	 * setWebhook.
	 *
	 * @return void
	 */
	public function ajax_set_webhook() {
		$this->guard();

		$url    = TMB_Chat_Bale::webhook_url();
		$result = $this->call_with_submitted( '/setWebhook', array( 'url' => $url ) );

		if ( is_wp_error( $result ) ) {
			wp_send_json_error(
				array(
					'message' => $result->get_error_message(),
					'hint'    => __( 'اگر سایت HTTPS نیست یا وب‌هوک کار نکرد، روش دریافت را روی «دریافت خودکار» بگذارید.', 'tamas-box' ),
				)
			);
		}

		TMB_Chat_DB::set_state( 'webhook_set_at', time() );

		wp_send_json_success(
			array(
				'message' => __( 'وب‌هوک با موفقیت ثبت شد ✔', 'tamas-box' ),
				'url'     => $url,
			)
		);
	}

	/**
	 * deleteWebhook.
	 *
	 * @return void
	 */
	public function ajax_delete_webhook() {
		$this->guard();

		$result = $this->call_with_submitted( '/deleteWebhook' );

		if ( is_wp_error( $result ) ) {
			wp_send_json_error( array( 'message' => $result->get_error_message() ) );
		}

		wp_send_json_success( array( 'message' => __( 'وب‌هوک حذف شد.', 'tamas-box' ) ) );
	}

	/**
	 * getWebhookInfo.
	 *
	 * @return void
	 */
	public function ajax_webhook_info() {
		$this->guard();

		$result = $this->call_with_submitted( '/getWebhookInfo' );

		if ( is_wp_error( $result ) ) {
			wp_send_json_error( array( 'message' => $result->get_error_message() ) );
		}

		$info = isset( $result['result'] ) ? $result['result'] : array();
		$line = array();

		$line[] = __( 'آدرس ثبت‌شده:', 'tamas-box' ) . ' ' . ( ! empty( $info['url'] ) ? $info['url'] : __( 'خالی', 'tamas-box' ) );
		$line[] = __( 'آدرس مورد انتظار افزونه:', 'tamas-box' ) . ' ' . TMB_Chat_Bale::webhook_url();

		if ( isset( $info['pending_update_count'] ) ) {
			$line[] = __( 'آپدیت‌های در صف:', 'tamas-box' ) . ' ' . (int) $info['pending_update_count'];
		}
		if ( ! empty( $info['last_error_message'] ) ) {
			$line[] = __( 'آخرین خطا:', 'tamas-box' ) . ' ' . $info['last_error_message'];
		}
		if ( ! empty( $info['last_synchronization_error_message'] ) ) {
			$line[] = $info['last_synchronization_error_message'];
		}

		$ok = ( ! empty( $info['url'] ) && $info['url'] === TMB_Chat_Bale::webhook_url() );

		wp_send_json_success(
			array(
				'message' => implode( "\n", $line ),
				'match'   => $ok ? 1 : 0,
				'info'    => $info,
			)
		);
	}

	/**
	 * Empty every page cache we know about.
	 *
	 * A cached page from before the chat module existed has the chat button but
	 * no chat window and no chat.js in it - which looks exactly like a dead
	 * button. Purging is the first thing to try.
	 *
	 * @return void
	 */
	public function ajax_purge_cache() {
		$this->guard();

		$done = array();

		if ( function_exists( 'rocket_clean_domain' ) ) {
			rocket_clean_domain();
			$done[] = 'WP Rocket';
		}
		if ( function_exists( 'w3tc_flush_all' ) ) {
			w3tc_flush_all();
			$done[] = 'W3 Total Cache';
		}
		if ( function_exists( 'wp_cache_clear_cache' ) ) {
			wp_cache_clear_cache();
			$done[] = 'WP Super Cache';
		}
		if ( class_exists( 'autoptimize_cache' ) && method_exists( 'autoptimize_cache', 'clearall_cache' ) ) {
			autoptimize_cache::clearall_cache();
			$done[] = 'Autoptimize';
		}
		if ( function_exists( 'sg_cachepress_purge_cache' ) ) {
			sg_cachepress_purge_cache();
			$done[] = 'SiteGround Optimizer';
		}

		// LiteSpeed / Breeze / host level listeners.
		do_action( 'litespeed_purge_all' );
		do_action( 'breeze_clear_all_cache' );
		do_action( 'tmb_purge_all_caches' );

		if ( function_exists( 'wp_cache_flush' ) ) {
			wp_cache_flush();
			$done[] = __( 'کش آبجکت وردپرس', 'tamas-box' );
		}

		wp_send_json_success(
			array(
				'message' => $done
					? sprintf( __( 'کش پاک شد: %s', 'tamas-box' ), implode( ' , ', $done ) )
					: __( 'افزونه کش شناخته‌شده‌ای پیدا نشد؛ اگر کش در سطح هاست یا Cloudflare است، از همان‌جا پاک کنید.', 'tamas-box' ),
				'hint'    => __( 'حالا سایت را با Ctrl+Shift+R باز کنید و دوباره دکمه چت را بزنید. اگر هنوز کار نکرد، «گزارش عیب‌یابی» را بگیرید - بخش «بررسی صفحه سایت» دقیقاً می‌گوید در HTML چه چیزی کم است.', 'tamas-box' ),
			)
		);
	}

	/**
	 * Deep link that registers whoever opens it as an admin chat.
	 *
	 * Bale cannot message a phone number - a bot only knows chat ids - so this
	 * link removes the need to find the number by hand.
	 *
	 * @return void
	 */
	public function ajax_admin_link() {
		$this->guard();

		$url = TMB_Chat_Bale::admin_join_url();

		if ( is_wp_error( $url ) ) {
			wp_send_json_error(
				array(
					'message' => $url->get_error_message(),
					'hint'    => __( 'ابتدا توکن را وارد کرده و «تست اتصال» را بزنید تا نام کاربری بازو شناخته شود.', 'tamas-box' ),
				)
			);
		}

		wp_send_json_success(
			array(
				'message' => __( 'لینک ثبت مدیر (۲۴ ساعت معتبر است):', 'tamas-box' ),
				'url'     => $url,
				'hint'    => __( 'این لینک را در بله باز کنید (یا برای همکارتان بفرستید). به‌محض باز شدن، شناسه چت به‌صورت خودکار در تنظیمات ثبت می‌شود و بازو یک پیام تأیید می‌فرستد.', 'tamas-box' ),
			)
		);
	}

	/**
	 * Move the "چت آنلاین" item to the top of every contact box.
	 *
	 * @return void
	 */
	public function ajax_item_first() {
		$this->guard();

		$changed = TMB_Settings::chat_items_first();

		if ( ! $changed ) {
			wp_send_json_success(
				array(
					'message' => __( 'تغییری لازم نبود: یا آیتم چت در هیچ باکسی نیست، یا همین حالا اول فهرست است.', 'tamas-box' ),
					'hint'    => __( 'برای ساخت آیتم چت، در تب «باکس‌های تماس» روی «+ آیتم چت آنلاین» بزنید. با کشیدن و رها کردن هم می‌توانید ترتیب را عوض کنید.', 'tamas-box' ),
				)
			);
		}

		wp_send_json_success(
			array(
				/* translators: %d: number of boxes */
				'message' => sprintf( __( 'دکمه «چت آنلاین» در %d باکس به اول فهرست منتقل شد.', 'tamas-box' ), (int) $changed ),
				'hint'    => __( 'این صفحه را تازه کنید تا ترتیب جدید را ببینید.', 'tamas-box' ),
			)
		);
	}

	/**
	 * Full status report - the fastest way to find out why something is off.
	 *
	 * @return void
	 */
	public function ajax_diag() {
		$this->guard();

		wp_send_json_success( array( 'message' => self::diag_report() ) );
	}

	/**
	 * Build the diagnostics report as plain text.
	 *
	 * Also served on ?tmb_chat_report=1 (see TMB_Chat::maybe_report()) so it can
	 * be opened in a browser tab and copy pasted into a support message.
	 *
	 * @return string
	 */
	public static function diag_report() {
	$yn = function ( $value ) {
			return $value ? 'بله ✔' : 'خیر ✖';
		};

		$c     = TMB_Settings::chat();
		$s     = TMB_Settings::get();
		$state = TMB_Chat_DB::state();
		$error = TMB_Chat_Bale::last_error();

		$L   = array();
		$L[] = '—— گزارش عیب‌یابی تماس باکس ——';
		$header = get_file_data( TMB_FILE, array( 'Version' => 'Version' ) );
		$L[]    = 'نسخه افزونه: ' . TMB_VERSION . ' (هدر فایل: ' . ( isset( $header['Version'] ) ? $header['Version'] : '?' ) . ') | وردپرس: ' . get_bloginfo( 'version' ) . ' | PHP: ' . PHP_VERSION;
		$L[]    = 'مسیر فایل اصلی: ' . TMB_FILE;
		$L[] = 'آدرس سایت: ' . home_url() . ( is_ssl() ? ' (HTTPS ✔)' : ' (HTTP ✖ — بله فقط وب‌هوک HTTPS را قبول می‌کند)' );
		$L[] = 'زمان سرور: ' . wp_date( 'Y-m-d H:i:s' ) . ' | timezone: ' . wp_timezone_string();
		$L[] = '';
		$L[] = '[ماژول چت]';
		$L[] = 'افزونه فعال: ' . $yn( ! empty( $s['enabled'] ) );
		$L[] = 'چت آنلاین فعال: ' . $yn( ! empty( $c['enabled'] ) ) . '  ← اگر «خیر» است، دکمه چت در سایت کار نمی‌کند';
		$L[] = 'TMB_Chat::enabled(): ' . $yn( TMB_Chat::enabled() );
		$L[] = 'حالت دکمه: ' . $c['launcher'] . ' (item = فقط داخل باکس تماس)';
		$L[] = 'فقط کاربران واردشده: ' . $yn( ! empty( $c['require_login'] ) );
		$L[] = 'ساعات پاسخگویی: ' . ( empty( $c['hours_enabled'] )
			? 'خاموش (همیشه آنلاین)'
			: trim( $c['hours_from'] ) . '–' . trim( $c['hours_to'] ) . ' روزها: ' . ( (array) $c['hours_days'] ? implode( ',', (array) $c['hours_days'] ) : 'همه' ) );
		$L[] = 'همین حالا آنلاین؟ ' . $yn( TMB_Chat::is_online() );
		$L[] = 'پنجره چت در همین درخواست چاپ می‌شود؟ ' . $yn( TMB_Chat::instance()->should_render() ) . '  ← اگر «خیر» است، دکمه چت هیچ کاری نمی‌کند';
		$L[] = 'بازه‌ی بررسی پیام (ثانیه): ' . $c['poll_interval'] . ' / حالت بسته: ' . $c['poll_closed'];
		$L[] = '';
		$L[] = '[باکس‌ها و آیتم چت]';

		$chat_items = 0;
		foreach ( (array) $s['boxes'] as $box ) {
			$found = 0;
			$total = 0;
			foreach ( (array) ( isset( $box['items'] ) ? $box['items'] : array() ) as $item ) {
				$total++;
				if ( is_array( $item ) && isset( $item['action'] ) && 'chat' === $item['action'] && ! empty( $item['enabled'] ) ) {
					$found++;
				}
			}
			$chat_items += $found;
			$L[] = sprintf(
				'باکس %s (%s): فعال=%s | %d آیتم | %d آیتم چت',
				isset( $box['id'] ) ? $box['id'] : '?',
				isset( $box['name'] ) ? $box['name'] : '?',
				! empty( $box['enabled'] ) ? 'بله' : 'خیر',
				$total,
				$found
			);
		}
		$L[] = 'boxes_need_chat(): ' . $yn( TMB_Chat::boxes_need_chat() );
		$L[] = 'مجموع آیتم‌های چت: ' . $chat_items . ( $chat_items ? '' : '  ← هیچ دکمه چتی در سایت نیست!' );
		$L[] = '';
		$L[] = '[بله]';
		$L[] = 'ارسال به بله فعال: ' . $yn( ! empty( $c['bale_enabled'] ) );
		$L[] = 'توکن: ' . ( '' !== trim( (string) $c['bale_token'] )
			? substr( (string) $c['bale_token'], 0, 9 ) . '…(' . strlen( (string) $c['bale_token'] ) . ' کاراکتر)'
			: 'خالی ✖' );
		$L[] = 'آدرس API: ' . $c['bale_api_base'];
		$L[] = 'نمونه فراخوانی: ' . str_replace( (string) $c['bale_token'], '****', TMB_Chat_Bale::endpoint( '/getMe' ) );
		$L[] = 'شناسه چت مدیران: ' . ( '' !== trim( (string) $c['bale_chat_ids'] ) ? str_replace( array( "
	", "
	" ), ' , ', (string) $c['bale_chat_ids'] ) : 'خالی ✖ ← پیام مشتریان به هیچ‌کس نمی‌رسد' );
		$L[] = 'نام کاربری بازو: ' . ( $c['bale_bot_username'] ? '@' . $c['bale_bot_username'] : 'ناشناخته' );
		$L[] = 'is_ready(): ' . $yn( TMB_Chat_Bale::is_ready() );
		$L[] = 'https بودن home_url: ' . $yn( 'https' === wp_parse_url( home_url(), PHP_URL_SCHEME ) ) . '  ← بله فقط وب‌هوک https را قبول می‌کند';
		$L[] = 'روش دریافت پاسخ: ' . $c['bale_mode']
			. ( (int) TMB_Chat_DB::get_state( 'mode_switched_http', 0 ) ? ' (افزونه به‌خاطر http بودن سایت، خودکار به «دریافت خودکار» تغییر داد)' : '' );
		$L[] = 'آدرس وب‌هوک: ' . TMB_Chat_Bale::webhook_url();
		$L[] = 'آخرین وب‌هوک دریافتی: ' . ( ! empty( $state['last_webhook'] ) ? wp_date( 'Y-m-d H:i:s', (int) $state['last_webhook'] ) : 'هیچ ✖' );
		$L[] = 'آخرین getUpdates: ' . ( ! empty( $state['last_poll'] ) ? wp_date( 'Y-m-d H:i:s', (int) $state['last_poll'] ) : 'هیچ' );
		$L[] = 'update_offset: ' . ( isset( $state['update_offset'] ) ? (int) $state['update_offset'] : 0 ) . ' | last_update_id: ' . ( isset( $state['last_update_id'] ) ? (int) $state['last_update_id'] : 0 );
		$L[] = 'آخرین خطای بله: ' . ( ! empty( $error['message'] )
			? $error['message'] . ( ! empty( $error['time'] ) ? ' (' . wp_date( 'Y-m-d H:i', (int) $error['time'] ) . ')' : '' )
			: 'ندارد' );
		$L[] = '';
		$L[] = '[دیتابیس و کرون]';
		$L[] = 'جدول‌ها ساخته شده: ' . $yn( TMB_Chat_DB::tables_exist() );
		$L[] = 'db_version: ' . ( isset( $state['db_version'] ) ? $state['db_version'] : '-' );

		$counters = TMB_Chat_DB::counters();
		$L[]      = 'گفتگوی باز: ' . (int) $counters['open'] . ' | بی‌پاسخ: ' . (int) $counters['unread'];

		$next = wp_next_scheduled( TMB_Chat::CRON_HOOK );
		$L[]  = 'کرون (tmb_chat_cron): ' . ( $next ? 'زمان‌بندی شده، اجرای بعدی ' . wp_date( 'Y-m-d H:i:s', (int) $next ) : 'زمان‌بندی نشده ✖' );
		$L[]  = 'WP_CRON_LOCK / DISABLE_WP_CRON: ' . ( defined( 'DISABLE_WP_CRON' ) && DISABLE_WP_CRON ? 'غیرفعال ✖' : 'فعال' );
		$L[]  = '';
		$L[]  = '[فایل‌ها و REST]';
		$L[]  = 'chat.css موجود: ' . $yn( file_exists( TMB_PATH . 'assets/css/chat.css' ) ) . ' | chat.js موجود: ' . $yn( file_exists( TMB_PATH . 'assets/js/chat.js' ) );
		$L[]  = 'TMB_URL: ' . TMB_URL;

		$routes = rest_get_server()->get_routes();
		$L[]    = 'مسیر REST /tmb/v1/chat/session: ' . $yn( isset( $routes['/tmb/v1/chat/session'] ) );
		$L[]    = 'rest_url(): ' . rest_url( 'tmb/v1/chat/session' );
		$L[]    = '';
		$L[]    = '[بررسی صفحه سایت - همان چیزی که بازدیدکننده می‌گیرد]';
		$probe_url = add_query_arg( 'tmb_probe', '1', home_url( '/' ) );
		$probe     = wp_remote_get(
			$probe_url,
			array(
				'timeout'     => 25,
				'sslverify'   => false,
				'redirection' => 3,
				'headers'     => array(
					'Cache-Control' => 'no-cache',
					'Pragma'        => 'no-cache',
				),
			)
		);

		if ( is_wp_error( $probe ) ) {
			$L[] = '  ✖ درخواست داخلی به سایت شکست خورد: ' . $probe->get_error_message();
			$L[] = '  (بعضی هاست‌ها درخواست loopback را می‌بندند؛ در این صورت این بخش قابل بررسی نیست)';
		} else {
			$html = (string) wp_remote_retrieve_body( $probe );
			$L[]  = '  آدرس: ' . $probe_url . ' | HTTP ' . (int) wp_remote_retrieve_response_code( $probe ) . ' | ' . number_format( strlen( $html ) ) . ' بایت';
			$L[]  = '  آیتم چت در HTML: ' . $yn( false !== strpos( $html, 'data-tmb-action="chat"' ) );
			$L[]  = '  پنجره چت (#tmbc-root) در HTML: ' . $yn( false !== strpos( $html, 'id="tmbc-root"' ) );
			$L[]  = '  تنظیمات چت روی خود ویجت (data-tmbc-config): ' . $yn( false !== strpos( $html, 'data-tmbc-config' ) );
			$L[]  = '  اسکریپت chat.js در HTML: ' . $yn( false !== strpos( $html, 'chat.js' ) );
			$L[]  = '  اسکریپت frontend.js در HTML: ' . $yn( false !== strpos( $html, 'frontend.js' ) );
			$L[]  = '  پیکربندی TMB_CHAT در HTML: ' . $yn( false !== strpos( $html, 'TMB_CHAT' ) );

			if ( preg_match( '#<script[^>]*chat\.js[^>]*>#i', $html, $m ) ) {
				$L[] = '  تگ اسکریپت چت: ' . trim( preg_replace( '/\s+/', ' ', $m[0] ) );
			} else {
				$L[] = '  تگ اسکریپت چت: پیدا نشد ✖ ← در HTMLی که بازدیدکننده می‌گیرد، اسکریپت چت وجود ندارد (کش قدیمی یا بهینه‌ساز جاوااسکریپت)';
			}

			$cache = array();
			if ( defined( 'LSCWP_V' ) ) {
				$cache[] = 'LiteSpeed Cache ' . LSCWP_V;
			}
			if ( defined( 'WP_ROCKET_VERSION' ) ) {
				$cache[] = 'WP Rocket ' . WP_ROCKET_VERSION;
			}
			if ( defined( 'W3TC' ) ) {
				$cache[] = 'W3 Total Cache';
			}
			if ( defined( 'AUTOPTIMIZE_PLUGIN_VERSION' ) ) {
				$cache[] = 'Autoptimize ' . AUTOPTIMIZE_PLUGIN_VERSION;
			}
			if ( defined( 'WPCACHEHOME' ) ) {
				$cache[] = 'WP Super Cache';
			}
			if ( defined( 'SG_OPTIMIZER_VERSION' ) ) {
				$cache[] = 'SiteGround Optimizer';
			}
			if ( class_exists( 'Breeze_Config' ) ) {
				$cache[] = 'Breeze';
			}
			if ( defined( 'WP_CACHE' ) && WP_CACHE ) {
				$cache[] = 'WP_CACHE=true';
			}
			$L[] = '  افزونه‌های کش/بهینه‌ساز شناسایی‌شده: ' . ( $cache ? implode( ' , ', $cache ) : 'هیچ' );

			foreach ( array( 'x-litespeed-cache', 'x-lscache', 'cf-cache-status', 'x-cache', 'x-varnish', 'x-proxy-cache' ) as $hdr ) {
				$value = wp_remote_retrieve_header( $probe, $hdr );
				if ( ! empty( $value ) && ! is_array( $value ) ) {
					$L[] = '  هدر ' . $hdr . ': ' . $value;
				}
			}
		}

		$L[]    = '';
		$L[]    = '[تست زنده API بله]';

		$me = TMB_Chat_Bale::get_me();
		if ( is_wp_error( $me ) ) {
			$L[] = 'getMe: ✖ ' . $me->get_error_message();
		} else {
			$bot = isset( $me['result'] ) ? $me['result'] : array();
			$L[] = 'getMe: ✔ ' . ( isset( $bot['first_name'] ) ? $bot['first_name'] : '?' ) . ' (@' . ( isset( $bot['username'] ) ? $bot['username'] : '?' ) . ') id=' . ( isset( $bot['id'] ) ? $bot['id'] : '?' );
		}

		$info = TMB_Chat_Bale::webhook_info();
		if ( is_wp_error( $info ) ) {
			$L[] = 'getWebhookInfo: ✖ ' . $info->get_error_message();
		} else {
			$r    = isset( $info['result'] ) ? $info['result'] : array();
			$L[]  = 'getWebhookInfo: url=' . ( ! empty( $r['url'] ) ? $r['url'] : '(خالی = وب‌هوک ثبت نشده)' );
			$L[]  = '  pending=' . ( isset( $r['pending_update_count'] ) ? (int) $r['pending_update_count'] : 0 )
				. ( ! empty( $r['last_error_message'] ) ? ' | last_error=' . $r['last_error_message'] : '' );
		}

		$pull = TMB_Chat_Bale::pull_updates( 3 );
		$L[]  = 'pull_updates (تست دستی): ' . (int) $pull . ' پیام پردازش شد';
		$L[]  = '';
		$L[]  = '—— پایان گزارش ——';

		return implode( "\n", $L );
	}

	/**
	 * Manually pull updates (getUpdates) - handy right after setup.
	 *
	 * @return void
	 */
	public function ajax_poll_now() {
		$this->guard();

		TMB_Chat_DB::maybe_install();

		$count = TMB_Chat_Bale::pull_updates( 5 );

		wp_send_json_success(
			array(
				/* translators: %d: number of updates */
				'message' => sprintf( esc_html__( '%d پیام دریافت و پردازش شد.', 'tamas-box' ), (int) $count ),
				'count'   => (int) $count,
			)
		);
	}
}
